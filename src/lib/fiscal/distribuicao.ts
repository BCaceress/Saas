import "server-only";
import { decifrar } from "@/lib/crypto";
import { basePrisma, txComTenant } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { featureAtiva } from "@/lib/planos";
import { logErro, logInfo } from "@/lib/log";
import { carregarConfigFiscal, providerDoTenant } from "./index";
import { distribuicaoNuvemFiscal, type DocumentoDistribuido } from "./nuvem-fiscal";
import { importarNotasXml } from "./entrada";
import { registrarImportacoes } from "./import-log";
import {
  ambienteDistribuicao,
  consultarDistribuicaoSefaz,
  type DocumentoSefaz,
} from "./sefaz-distribuicao";
import { manifestarDistribuicaoSefaz } from "./sefaz-evento";
import type { ManifestacaoTipo, Prisma } from "@/generated/prisma";

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
// A consulta é feita diretamente no serviço oficial quando o certificado A1
// está guardado no NoHub. O adapter Nuvem Fiscal permanece como fallback de
// compatibilidade para certificados antigos que ainda não foram reenviados.
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
  emitenteId: string;
  cnpj: string;
  uf: string;
  siteId: string;
  certificadoPfx: string | null;
  certificadoSenha: string | null;
  distribuicao: ReturnType<typeof distribuicaoNuvemFiscal> | null;
};

/**
 * null = loja sem emitente, ou sem certificado A1 guardado e sem o provedor
 * legado (Nuvem Fiscal). Com o certificado, nada mais é exigido: nem provedor,
 * nem config fiscal, nem o add-on de emissão — receber nota não emite nada.
 */
async function contexto(tenantId: string, siteId: string): Promise<Contexto | null> {
  const emitente = await txComTenant(tenantId, (tx) =>
    tx.fiscalEmitente.findFirst({
      where: { siteId },
      select: {
        id: true,
        cnpj: true,
        uf: true,
        certificadoPfx: true,
        certificadoSenha: true,
      },
    }),
  );
  if (!emitente) return null;

  const base = {
    emitenteId: emitente.id,
    cnpj: emitente.cnpj,
    uf: emitente.uf,
    siteId,
  };
  const certificadoPfx = decifrar(emitente.certificadoPfx);
  const certificadoSenha = decifrar(emitente.certificadoSenha);
  if (certificadoPfx && certificadoSenha) {
    return { ...base, certificadoPfx, certificadoSenha, distribuicao: null };
  }

  // Legado: certificado enviado só ao provedor antes da consulta direta.
  const cfg = await carregarConfigFiscal(tenantId);
  if (cfg?.provider !== "NUVEM_FISCAL") return null;
  return {
    ...base,
    certificadoPfx: null,
    certificadoSenha: null,
    distribuicao: distribuicaoNuvemFiscal({ apiToken: cfg.apiToken, ambiente: cfg.ambiente }),
  };
}

export async function distribuicaoDisponivel(
  tenantId: string,
  siteId: string,
): Promise<boolean> {
  const ctx = await contexto(tenantId, siteId);
  return Boolean(ctx?.certificadoPfx || ctx?.distribuicao);
}

const ESPERA_SEFAZ_MS = 60 * 60 * 1000;

/**
 * Quando a SEFAZ diz que não há mais nada (137, ou ultNSU == maxNSU), a regra
 * é esperar 1 hora. Consultar antes disso devolve 656 "Consumo Indevido" — e o
 * 656 reinicia a espera. Erro de rede/certificado não trava: pode tentar já.
 */
export function proximaConsultaSefaz(emitente: {
  distribuicaoConsultadoEm: Date | null;
  distribuicaoUltNsu: bigint;
  distribuicaoMaxNsu: bigint;
  distribuicaoUltimoErro: string | null;
}): Date | null {
  if (!emitente.distribuicaoConsultadoEm) return null;
  const esgotou = emitente.distribuicaoUltimoErro
    ? emitente.distribuicaoUltimoErro.startsWith("SEFAZ 656")
    : emitente.distribuicaoUltNsu >= emitente.distribuicaoMaxNsu;
  if (!esgotou) return null;
  const libera = new Date(emitente.distribuicaoConsultadoEm.getTime() + ESPERA_SEFAZ_MS);
  return libera > new Date() ? libera : null;
}

type ConsultaDireta = {
  documentos: DocumentoDistribuido[];
  /** Preenchido quando a SEFAZ não foi chamada (ou não pode ser de novo) até esta hora. */
  proximaConsultaEm: Date | null;
};

async function consultarDireto(tenantId: string, ctx: Contexto): Promise<ConsultaDireta> {
  if (!ctx.certificadoPfx || !ctx.certificadoSenha) {
    throw new Error("Envie o certificado digital A1 desta loja para consultar a SEFAZ diretamente.");
  }

  const atual = await txComTenant(tenantId, (tx) =>
    tx.fiscalEmitente.findFirst({
      where: { id: ctx.emitenteId },
      select: {
        distribuicaoUltNsu: true,
        distribuicaoMaxNsu: true,
        distribuicaoConsultadoEm: true,
        distribuicaoUltimoErro: true,
      },
    }),
  );
  const bloqueadoAte = atual ? proximaConsultaSefaz(atual) : null;
  // Sem ir à SEFAZ: o acervo local ainda é processado por quem chamou.
  if (bloqueadoAte) return { documentos: [], proximaConsultaEm: bloqueadoAte };

  let resultado: Awaited<ReturnType<typeof consultarDistribuicaoSefaz>>;
  try {
    resultado = await consultarDistribuicaoSefaz({
      ambiente: ambienteDistribuicao(),
      uf: ctx.uf,
      cnpj: ctx.cnpj,
      pfxBase64: ctx.certificadoPfx,
      senha: ctx.certificadoSenha,
      ultNSU: atual?.distribuicaoUltNsu ?? BigInt(0),
    });
  } catch (e) {
    // Fica gravado para a tela de configuração mostrar por que a nota não veio.
    await txComTenant(tenantId, (tx) =>
      tx.fiscalEmitente.update({
        where: { id: ctx.emitenteId },
        data: {
          distribuicaoConsultadoEm: new Date(),
          distribuicaoUltimoErro: (e instanceof Error ? e.message : String(e)).slice(0, 500),
        },
      }),
    );
    throw e;
  }

  logInfo("fiscal.distribuicao.consulta", {
    tenantId,
    emitenteId: ctx.emitenteId,
    cStat: resultado.cStat,
    ultNSU: resultado.ultNSU.toString(),
    maxNSU: resultado.maxNSU.toString(),
    notas: resultado.documentos.length,
    ignorados: resultado.ignorados,
  });

  // Mesma chave no lote como resumo e como XML completo: fica a completa.
  const porChave = new Map<string, DocumentoSefaz>();
  for (const documento of resultado.documentos) {
    const visto = porChave.get(documento.chave);
    if (!visto || (visto.resumo && !documento.resumo)) porChave.set(documento.chave, documento);
  }

  // Em lote: com o acervo inicial (até 90 dias) uma ida e volta por nota
  // estoura o tempo da transação, e aí o cursor também não avança.
  await txComTenant(tenantId, async (tx) => {
    await tx.fiscalEmitente.update({
      where: { id: ctx.emitenteId },
      data: {
        distribuicaoUltNsu: resultado.ultNSU,
        distribuicaoMaxNsu: resultado.maxNSU,
        distribuicaoConsultadoEm: new Date(),
        distribuicaoUltimoErro: null,
      },
    });
    if (porChave.size === 0) return;

    const existentes = await tx.fiscalDistribuicaoDocumento.findMany({
      where: { emitenteId: ctx.emitenteId, chave: { in: [...porChave.keys()] } },
      select: { id: true, chave: true, resumo: true },
    });
    const existentePorChave = new Map(existentes.map((e) => [e.chave, e]));
    const novos: Prisma.FiscalDistribuicaoDocumentoCreateManyInput[] = [];

    for (const documento of porChave.values()) {
      const existente = existentePorChave.get(documento.chave);
      // Resumo atrasado não rebaixa um XML completo que já chegou.
      if (existente && !existente.resumo && documento.resumo) continue;
      const data = {
        nsu: documento.nsu,
        chave: documento.chave,
        emitCnpj: documento.emitCnpj,
        emitRazaoSocial: documento.emitRazaoSocial,
        valorTotal: documento.valorTotal,
        dataEmissao: documento.dataEmissao,
        schema: documento.schema,
        resumo: documento.resumo,
        xml: documento.resumo ? null : documento.xml,
      };
      if (existente) {
        await tx.fiscalDistribuicaoDocumento.update({
          where: { id: existente.id },
          data: { ...data, xml: data.xml ?? undefined },
        });
      } else {
        novos.push({ tenantId, emitenteId: ctx.emitenteId, ...data });
      }
    }
    if (novos.length > 0) {
      await tx.fiscalDistribuicaoDocumento.createMany({ data: novos, skipDuplicates: true });
    }
  });

  const documentos = resultado.documentos.map((documento) => ({
    externalId: documento.nsu.toString(),
    nsu: Number(documento.nsu),
    chave: documento.chave,
    resumo: documento.resumo,
    emitCnpj: documento.emitCnpj,
    emitRazaoSocial: documento.emitRazaoSocial,
    valorTotal: documento.valorTotal,
    dataEmissao: documento.dataEmissao,
    xml: documento.xml,
  }));
  const esgotou = resultado.ultNSU >= resultado.maxNSU;
  return {
    documentos,
    proximaConsultaEm: esgotou ? new Date(Date.now() + ESPERA_SEFAZ_MS) : null,
  };
}

export type ResultadoSincronizacao = {
  consultadas: number;
  importadas: number;
  aguardandoManifestacao: number;
  /** Notas em que demos ciência sozinhos para liberar o XML completo. */
  manifestadas: number;
  /** A SEFAZ só aceita nova consulta a partir daqui (regra de 1 h). */
  proximaConsultaEm: Date | null;
  /** true = a SEFAZ não foi chamada agora por causa da espera. */
  aguardando: boolean;
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
      "A busca automática de notas exige os dados fiscais da loja e um certificado digital A1.",
    );
  }

  const direta = ctx.certificadoPfx ? await consultarDireto(tenantId, ctx) : null;
  const documentosNovos = direta
    ? direta.documentos
    : ctx.distribuicao
      ? (await ctx.distribuicao.sincronizar(ctx.cnpj),
        await ctx.distribuicao.listarDocumentos(ctx.cnpj))
      : [];
  const aguardando = Boolean(direta?.proximaConsultaEm && direta.documentos.length === 0);
  // O cursor só traz o que é novo; o acervo local cobre o XML que chegou e
  // ainda não foi importado e o resumo ainda sem manifestação (a ciência
  // automática ligada depois também alcança esses).
  const documentosArmazenados = ctx.certificadoPfx
    ? await txComTenant(tenantId, (tx) =>
        tx.fiscalDistribuicaoDocumento.findMany({
          where: {
            emitenteId: ctx.emitenteId,
            OR: [
              { resumo: false, xml: { not: null } },
              { resumo: true, manifestacao: null },
            ],
          },
          select: {
            nsu: true,
            chave: true,
            resumo: true,
            emitCnpj: true,
            emitRazaoSocial: true,
            valorTotal: true,
            dataEmissao: true,
            xml: true,
          },
        }),
      )
    : [];
  const documentos = [
    ...documentosNovos,
    ...documentosArmazenados.map((d) => ({
      externalId: d.nsu.toString(),
      nsu: Number(d.nsu),
      chave: d.chave,
      resumo: d.resumo,
      emitCnpj: d.emitCnpj,
      emitRazaoSocial: d.emitRazaoSocial,
      valorTotal: d.valorTotal == null ? null : Number(d.valorTotal),
      dataEmissao: d.dataEmissao,
      xml: d.resumo ? undefined : (d.xml ?? undefined),
    })),
  ]
    // Mesma chave como resumo e completa: vale a completa.
    .sort((a, b) => Number(a.resumo) - Number(b.resumo))
    .filter((d, i, all) => all.findIndex((item) => item.chave === d.chave) === i);
  const novos = await filtrarNaoImportados(tenantId, documentos);

  let importadas = 0;
  for (const d of novos.filter((d) => !d.resumo)) {
    const importada = await importarDoProvedor(ctx, { tenantId, siteId, userId }, d);
    if (importada) importadas += 1;
  }

  const resumos = novos.filter((d) => d.resumo);
  const manifestadas = await darCienciaAutomatica({ tenantId, siteId, userId }, resumos);

  return {
    consultadas: documentos.length,
    importadas: importadas + manifestadas,
    aguardandoManifestacao: resumos.length - manifestadas,
    manifestadas,
    proximaConsultaEm: direta?.proximaConsultaEm ?? null,
    aguardando,
  };
}

/** Notas que a SEFAZ mostra mas cujo XML ainda depende de manifestação. */
export async function listarAguardandoManifestacao(
  tenantId: string,
  siteId: string,
): Promise<NotaAguardandoManifestacao[]> {
  const ctx = await contexto(tenantId, siteId);
  if (!ctx) return [];

  if (ctx.certificadoPfx) {
    const aguardando = await txComTenant(tenantId, (tx) =>
      tx.fiscalDistribuicaoDocumento.findMany({
        where: { emitenteId: ctx.emitenteId, resumo: true, manifestacao: null },
        orderBy: { dataEmissao: "desc" },
      }),
    );
    return aguardando.map((d) => ({
      chave: d.chave,
      externalId: d.nsu.toString(),
      emitCnpj: d.emitCnpj,
      emitRazaoSocial: d.emitRazaoSocial,
      valorTotal: d.valorTotal == null ? null : Number(d.valorTotal),
      dataEmissao: d.dataEmissao?.toISOString() ?? null,
      ...serieENumeroDaChave(d.chave),
    }));
  }

  if (!ctx.distribuicao) return [];
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
  if (!ctx) throw new Error("Manifestação exige os dados fiscais e o certificado A1 da loja.");

  const r = ctx.certificadoPfx && ctx.certificadoSenha
    ? await manifestarDistribuicaoSefaz({
        ambiente: ambienteDistribuicao(),
        cnpj: ctx.cnpj,
        chave,
        pfxBase64: ctx.certificadoPfx,
        senha: ctx.certificadoSenha,
        tipo,
        justificativa,
      })
    : await (async () => {
        if (!ctx.distribuicao) {
          throw new Error("Envie o certificado digital A1 desta loja para manifestar a nota.");
        }
        const provider = await providerDoTenant(tenantId, { exigirAtivo: false });
        return provider.manifestar({ cnpj: ctx.cnpj, chave, tipo, justificativa });
      })();

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
      await tx.fiscalDistribuicaoDocumento.updateMany({
        where: { emitenteId: ctx.emitenteId, chave },
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
    if (ctx.certificadoPfx && ctx.certificadoSenha) {
      // Depois da ciência o procNFe sai pela consulta da chave. A SEFAZ às vezes
      // demora a liberar — falhar aqui não desfaz a manifestação, que já valeu;
      // a próxima sincronização traz o XML pelo cursor.
      let completo: DocumentoSefaz | undefined;
      try {
        const liberado = await consultarDistribuicaoSefaz({
          ambiente: ambienteDistribuicao(),
          uf: ctx.uf,
          cnpj: ctx.cnpj,
          pfxBase64: ctx.certificadoPfx,
          senha: ctx.certificadoSenha,
          ultNSU: BigInt(0),
          chaveConsulta: chave,
        });
        completo = liberado.documentos.find((d) => d.chave === chave && !d.resumo);
      } catch (e) {
        logErro("fiscal.distribuicao.xml-pos-manifestacao", e, { chave });
      }
      if (completo) {
        const xml = completo.xml;
        await txComTenant(tenantId, (tx) =>
          tx.fiscalDistribuicaoDocumento.updateMany({
            where: { emitenteId: ctx.emitenteId, chave },
            data: { resumo: false, xml, schema: completo.schema },
          }),
        );
        importada = await importarDoProvedor(
          ctx,
          { tenantId, siteId, userId },
          {
            externalId: completo.nsu.toString(),
            nsu: Number(completo.nsu),
            chave: completo.chave,
            resumo: false,
            emitCnpj: completo.emitCnpj,
            emitRazaoSocial: completo.emitRazaoSocial,
            valorTotal: completo.valorTotal,
            dataEmissao: completo.dataEmissao,
            xml,
          },
        );
      }
      return {
        ok: true,
        mensagem:
          importada
            ? "Manifestação registrada diretamente na SEFAZ e nota importada."
            : "Manifestação registrada diretamente na SEFAZ. O XML completo costuma liberar em alguns minutos — sincronize de novo.",
        importada,
      };
    }
    if (!ctx.distribuicao) throw new Error("Envie o certificado digital A1 desta loja.");
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

/**
 * Ciência automática — a nota chega completa sem ninguém clicar.
 *
 * Três limites, todos deliberados:
 *   1. só com `manifestacaoAutomatica` ligado (padrão desligado): manifestação
 *      NÃO tem desfazer na SEFAZ;
 *   2. só CIÊNCIA. "Confirmação da operação" declara que a mercadoria chegou —
 *      isso é a conferência física dizendo, nunca um job;
 *   3. só de CNPJ que já é fornecedor cadastrado. Nota de desconhecido é
 *      exatamente o caso em que alguém precisa olhar antes de dar ciência.
 *
 * Falha de uma nota não derruba as outras: SEFAZ fora do ar é rotina.
 */
async function darCienciaAutomatica(
  alvo: { tenantId: string; siteId: string; userId?: string | null },
  resumos: DocumentoDistribuido[],
): Promise<number> {
  if (resumos.length === 0) return 0;

  const cfg = await carregarConfigFiscal(alvo.tenantId);
  if (!cfg?.manifestacaoAutomatica) return 0;

  const cnpjs = [...new Set(resumos.map((d) => d.emitCnpj))];
  const fornecedores = await txComTenant(alvo.tenantId, (tx) =>
    tx.supplier.findMany({ where: { cnpj: { in: cnpjs } }, select: { cnpj: true } }),
  );
  const conhecido = new Set(fornecedores.map((f) => f.cnpj));

  let manifestadas = 0;
  for (const d of resumos.filter((r) => conhecido.has(r.emitCnpj))) {
    try {
      const r = await manifestarNota({
        tenantId: alvo.tenantId,
        siteId: alvo.siteId,
        chave: d.chave,
        tipo: "CIENCIA",
        userId: alvo.userId,
      });
      if (r.importada) manifestadas += 1;
    } catch (e) {
      logErro("fiscal.distribuicao.ciencia-automatica", e, { chave: d.chave });
    }
  }
  return manifestadas;
}

/**
 * Job: puxa a SEFAZ de todos os tenants com distribuição configurada.
 *
 * Cross-tenant sob RLS — a lista sai de `Tenant` (tabela sem policy) e cada
 * tenant é processado dentro de `runWithTenant`. Filtrar por relação aqui
 * devolveria zero linha em silêncio.
 */
export async function sincronizarDistribuicaoTodos(): Promise<{
  tenants: number;
  lojas: number;
  importadas: number;
  erros: number;
}> {
  // Certificado guardado no NoHub não depende do add-on de emissão (receber
  // nota não emite nada); o caminho legado pela Nuvem Fiscal tem custo por
  // consulta e continua restrito a quem contratou o fiscal.
  const tenants = await basePrisma.tenant.findMany({
    where: { status: { not: "CANCELED" } },
    select: { id: true, moduloFiscal: true, plano: true, addons: true, lojasExtras: true },
  });

  let comCertificado = 0;
  let lojas = 0;
  let importadas = 0;
  let erros = 0;

  for (const t of tenants) {
    try {
      const emitentes = await txComTenant(t.id, (tx) =>
        tx.fiscalEmitente.findMany({
          where: {
            OR: [
              { certificadoPfx: { not: null } },
              ...(featureAtiva(t, "fiscal") ? [{ certificadoId: { not: null } }] : []),
            ],
          },
          select: { siteId: true },
        }),
      );
      if (emitentes.length === 0) continue;
      comCertificado += 1;

      for (const e of emitentes) {
        try {
          const r = await runWithTenant(t.id, () =>
            sincronizarDistribuicao({ tenantId: t.id, siteId: e.siteId }),
          );
          lojas += 1;
          importadas += r.importadas;
        } catch (err) {
          erros += 1;
          logErro("fiscal.distribuicao.job", err, { tenantId: t.id, siteId: e.siteId });
        }
      }
    } catch (err) {
      erros += 1;
      logErro("fiscal.distribuicao.job", err, { tenantId: t.id });
    }
  }

  return { tenants: comCertificado, lojas, importadas, erros };
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
  const xml = documento.xml ?? (ctx.distribuicao
    ? await ctx.distribuicao.baixarXml(documento.externalId)
    : null);
  if (!xml) throw new Error("A SEFAZ ainda não liberou o XML completo desta nota.");
  const resultado = await importarNotasXml({
    tenantId: alvo.tenantId,
    siteId: alvo.siteId,
    arquivos: [{ nome: `${documento.chave}.xml`, bytes: new TextEncoder().encode(xml) }],
    userId: alvo.userId ?? null,
    cnpjDestino: ctx.cnpj,
  });

  await registrarImportacoes(
    { origem: "SEFAZ", siteId: alvo.siteId, usuarioId: alvo.userId ?? null },
    resultado,
  );

  return resultado.some((r) => r.status === "IMPORTADA");
}
