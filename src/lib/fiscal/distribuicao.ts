import "server-only";
import { txComTenant } from "@/lib/prisma";
import { carregarConfigFiscal, providerDoTenant } from "./index";
import { distribuicaoNuvemFiscal, type DocumentoDistribuido } from "./nuvem-fiscal";
import { importarNotasXml } from "./entrada";
import type { ManifestacaoTipo } from "@/generated/prisma";

// ============================================================
// Distribuição DF-e — as notas que fornecedores emitiram CONTRA o nosso CNPJ.
//
// É o caminho que fecha o módulo: em vez de pedir o XML ao fornecedor por
// e-mail, a nota aparece sozinha. O fluxo da SEFAZ é em dois tempos:
//
//   1. a consulta devolve um RESUMO (chave, emitente, valor) — sem itens;
//   2. só depois de MANIFESTAR (ciência ou confirmação) o XML completo fica
//      disponível para download, e aí vira FiscalInbound com itens.
//
// Por isso resumo não vira FiscalInbound: uma nota sem itens entraria no
// de-para como se já estivesse conciliada e geraria entrada vazia no estoque.
// Resumo fica na fila de manifestação, e só o XML completo é importado.
//
// Hoje só a Nuvem Fiscal expõe distribuição. Outros provedores caem no
// `null` e a tela simplesmente não oferece o recurso.
// ============================================================

/** Nota que a SEFAZ conhece e nós ainda não importamos. */
export type NotaAguardandoManifestacao = {
  chave: string;
  externalId: string;
  emitCnpj: string;
  emitRazaoSocial: string;
  valorTotal: number | null;
  dataEmissao: string | null;
  numero: number;
  serie: number;
};

/**
 * A chave de acesso carrega série e número — dá para exibir a nota resumida
 * sem esperar o XML completo.
 * Layout: cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1)
 */
function serieENumeroDaChave(chave: string): { serie: number; numero: number } {
  return {
    serie: Number(chave.slice(22, 25)) || 0,
    numero: Number(chave.slice(25, 34)) || 0,
  };
}

type Contexto = {
  cnpj: string;
  siteId: string;
  distribuicao: ReturnType<typeof distribuicaoNuvemFiscal>;
};

/** null = provedor sem distribuição, ou loja sem emitente/CNPJ configurado. */
async function contexto(tenantId: string, siteId: string): Promise<Contexto | null> {
  const cfg = await carregarConfigFiscal(tenantId);
  if (!cfg || cfg.provider !== "NUVEM_FISCAL") return null;

  const emitente = await txComTenant(tenantId, (tx) =>
    tx.fiscalEmitente.findFirst({ where: { siteId }, select: { cnpj: true } }),
  );
  if (!emitente) return null;

  return {
    cnpj: emitente.cnpj,
    siteId,
    distribuicao: distribuicaoNuvemFiscal({ apiToken: cfg.apiToken, ambiente: cfg.ambiente }),
  };
}

export async function distribuicaoDisponivel(
  tenantId: string,
  siteId: string,
): Promise<boolean> {
  return (await contexto(tenantId, siteId)) !== null;
}

export type ResultadoSincronizacao = {
  consultadas: number;
  importadas: number;
  aguardandoManifestacao: number;
};

/**
 * Puxa da SEFAZ o que houver de novo. Importa direto o que já veio completo e
 * devolve o resto para a fila de manifestação.
 *
 * Idempotente: a trava é `FiscalInbound.chave` única por tenant, então rodar
 * duas vezes não duplica nota nem entrada de estoque.
 */
export async function sincronizarDistribuicao(input: {
  tenantId: string;
  siteId: string;
  userId?: string | null;
}): Promise<ResultadoSincronizacao> {
  const { tenantId, siteId, userId } = input;
  const ctx = await contexto(tenantId, siteId);
  if (!ctx) {
    throw new Error(
      "A busca automática de notas exige o provedor Nuvem Fiscal e os dados fiscais da loja preenchidos.",
    );
  }

  await ctx.distribuicao.sincronizar(ctx.cnpj);
  const documentos = await ctx.distribuicao.listarDocumentos(ctx.cnpj);
  const novos = await filtrarNaoImportados(tenantId, documentos);

  let importadas = 0;
  for (const d of novos.filter((d) => !d.resumo)) {
    const importada = await importarDoProvedor(ctx, { tenantId, siteId, userId }, d);
    if (importada) importadas += 1;
  }

  return {
    consultadas: documentos.length,
    importadas,
    aguardandoManifestacao: novos.filter((d) => d.resumo).length,
  };
}

/** Notas que a SEFAZ mostra mas cujo XML ainda depende de manifestação. */
export async function listarAguardandoManifestacao(
  tenantId: string,
  siteId: string,
): Promise<NotaAguardandoManifestacao[]> {
  const ctx = await contexto(tenantId, siteId);
  if (!ctx) return [];

  const documentos = await ctx.distribuicao.listarDocumentos(ctx.cnpj);
  const novos = await filtrarNaoImportados(tenantId, documentos);

  return novos
    .filter((d) => d.resumo)
    .map((d) => ({
      chave: d.chave,
      externalId: d.externalId,
      emitCnpj: d.emitCnpj,
      emitRazaoSocial: d.emitRazaoSocial,
      valorTotal: d.valorTotal,
      dataEmissao: d.dataEmissao?.toISOString() ?? null,
      ...serieENumeroDaChave(d.chave),
    }));
}

const JUSTIFICATIVA_OBRIGATORIA: ManifestacaoTipo[] = ["DESCONHECIMENTO", "NAO_REALIZADA"];

/**
 * Manifesta o destinatário. Depois de CIENCIA/CONFIRMACAO o XML completo
 * libera, então já tentamos importar na mesma ação — é o que o operador quer:
 * apertar um botão e a nota aparecer pronta para o de-para.
 *
 * Manifestação NÃO tem desfazer na SEFAZ. Desconhecimento e operação não
 * realizada exigem justificativa por isso mesmo.
 */
export async function manifestarNota(input: {
  tenantId: string;
  siteId: string;
  chave: string;
  tipo: ManifestacaoTipo;
  justificativa?: string;
  userId?: string | null;
}): Promise<{ ok: boolean; mensagem: string; importada: boolean }> {
  const { tenantId, siteId, chave, tipo, userId } = input;
  const justificativa = input.justificativa?.trim() || undefined;

  if (JUSTIFICATIVA_OBRIGATORIA.includes(tipo) && (justificativa?.length ?? 0) < 15) {
    throw new Error(
      "Desconhecer ou negar a operação exige justificativa de pelo menos 15 caracteres.",
    );
  }

  const ctx = await contexto(tenantId, siteId);
  if (!ctx) throw new Error("Manifestação exige o provedor Nuvem Fiscal configurado.");

  const provider = await providerDoTenant(tenantId, { exigirAtivo: false });
  const r = await provider.manifestar({ cnpj: ctx.cnpj, chave, tipo, justificativa });

  await txComTenant(tenantId, async (tx) => {
    await tx.fiscalEvent.create({
      data: {
        tenantId,
        documentId: null,
        tipo: "MANIFESTACAO",
        codigo: r.codigo,
        mensagem: r.mensagem,
        motivo: `${rotuloManifestacao(tipo)} — NF-e ${chave}`,
        protocolo: r.protocolo,
        payload: r.payload === undefined ? undefined : JSON.parse(JSON.stringify(r.payload)),
        userId: userId ?? null,
      },
    });

    if (r.aceito) {
      // A nota pode já ter sido importada por XML solto — nesse caso o que
      // falta é só registrar que ela foi manifestada.
      await tx.fiscalInbound.updateMany({
        where: { chave },
        data: { manifestacao: tipo, manifestadoEm: new Date() },
      });
    }
  });

  if (!r.aceito) {
    return {
      ok: false,
      mensagem: r.mensagem ?? "A SEFAZ não registrou a manifestação.",
      importada: false,
    };
  }

  // Desconhecida ou não realizada não vira entrada — só o registro do evento.
  let importada = false;
  if (tipo === "CIENCIA" || tipo === "CONFIRMACAO") {
    const documentos = await ctx.distribuicao.listarDocumentos(ctx.cnpj);
    const completo = documentos.find((d) => d.chave === chave && !d.resumo);
    if (completo) {
      importada = await importarDoProvedor(ctx, { tenantId, siteId, userId }, completo);
    }
  }

  return {
    ok: true,
    mensagem: importada
      ? "Manifestação registrada e nota importada."
      : "Manifestação registrada. O XML completo costuma liberar em alguns minutos — sincronize de novo.",
    importada,
  };
}

const ROTULOS: Record<ManifestacaoTipo, string> = {
  CIENCIA: "Ciência da operação",
  CONFIRMACAO: "Confirmação da operação",
  DESCONHECIMENTO: "Desconhecimento da operação",
  NAO_REALIZADA: "Operação não realizada",
};

export function rotuloManifestacao(tipo: ManifestacaoTipo): string {
  return ROTULOS[tipo];
}

// ── Internos ────────────────────────────────────────────────

async function filtrarNaoImportados(
  tenantId: string,
  documentos: DocumentoDistribuido[],
): Promise<DocumentoDistribuido[]> {
  if (documentos.length === 0) return [];
  const chaves = documentos.map((d) => d.chave);
  const existentes = await txComTenant(tenantId, (tx) =>
    tx.fiscalInbound.findMany({ where: { chave: { in: chaves } }, select: { chave: true } }),
  );
  const jaTem = new Set(existentes.map((e) => e.chave));
  return documentos.filter((d) => !jaTem.has(d.chave));
}

/**
 * Baixa o XML completo e joga no mesmo importador do upload manual — o de-para
 * de itens, o vínculo com fornecedor e a geração de entrada são um caminho só.
 */
async function importarDoProvedor(
  ctx: Contexto,
  alvo: { tenantId: string; siteId: string; userId?: string | null },
  documento: DocumentoDistribuido,
): Promise<boolean> {
  const xml = await ctx.distribuicao.baixarXml(documento.externalId);
  const resultado = await importarNotasXml({
    tenantId: alvo.tenantId,
    siteId: alvo.siteId,
    arquivos: [{ nome: `${documento.chave}.xml`, bytes: new TextEncoder().encode(xml) }],
    userId: alvo.userId ?? null,
    cnpjDestino: ctx.cnpj,
  });
  return resultado.some((r) => r.status === "IMPORTADA");
}
