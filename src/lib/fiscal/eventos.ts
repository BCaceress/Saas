import "server-only";
import { txComTenant } from "@/lib/prisma";
import { carregarConfigFiscal, providerDoTenant } from "./index";
import type { ArquivoFiscal } from "./types";
import type { FiscalModelo } from "@/generated/prisma";

// ============================================================
// Eventos fiscais: cancelamento, carta de correção e inutilização.
//
// Tudo aqui é IRREVERSÍVEL do lado da SEFAZ — por isso cada função valida as
// regras ANTES de chamar o provedor, com mensagem que diz o que fazer quando
// não dá. "Rejeitado pela SEFAZ" sozinho não ajuda quem está no balcão.
//
// A trilha (FiscalEvent) é append-only: registra tanto o que deu certo quanto
// o que a SEFAZ recusou. É o histórico fiscal e a auditoria ao mesmo tempo.
// ============================================================

/** A SEFAZ exige no mínimo 15 caracteres em justificativa e correção. */
const MIN_JUSTIFICATIVA = 15;
/** Limite de cartas de correção por nota. */
const MAX_CCE = 20;

function validarTexto(texto: string, rotulo: string): string {
  const t = texto.trim();
  if (t.length < MIN_JUSTIFICATIVA) {
    throw new Error(
      `${rotulo} precisa de pelo menos ${MIN_JUSTIFICATIVA} caracteres — a SEFAZ recusa textos curtos.`,
    );
  }
  if (t.length > 255) throw new Error(`${rotulo} passa de 255 caracteres.`);
  return t;
}

export type ResultadoEventoFiscal = {
  ok: boolean;
  mensagem: string;
  protocolo?: string | null;
};

// ── Cancelamento ────────────────────────────────────────────

/**
 * Cancela uma nota autorizada. Só vale dentro da janela da SEFAZ da UF
 * (config.prazoCancelamentoMin, 30 min na maioria) — depois disso o caminho é
 * nota de devolução, e a UI precisa dizer isso em vez de deixar o operador
 * apertando um botão que nunca vai funcionar.
 */
export async function cancelarDocumento(input: {
  tenantId: string;
  documentId: string;
  justificativa: string;
  userId?: string | null;
}): Promise<ResultadoEventoFiscal> {
  const { tenantId, documentId, userId } = input;
  const justificativa = validarTexto(input.justificativa, "A justificativa");

  const doc = await txComTenant(tenantId, (tx) =>
    tx.fiscalDocument.findFirst({
      where: { id: documentId },
      select: {
        id: true,
        status: true,
        modelo: true,
        numero: true,
        serie: true,
        externalId: true,
        dataAutorizacao: true,
      },
    }),
  );
  if (!doc) throw new Error("Documento fiscal não encontrado.");

  if (doc.status === "CANCELADO") {
    return { ok: true, mensagem: "Esta nota já estava cancelada." };
  }
  if (doc.status !== "AUTORIZADO") {
    throw new Error(
      `Só nota autorizada pode ser cancelada — esta está como ${doc.status.toLowerCase()}.`,
    );
  }
  if (!doc.externalId) {
    throw new Error("Documento sem referência no provedor — não dá para cancelar.");
  }

  const cfg = await carregarConfigFiscal(tenantId);
  const prazoMin = cfg?.prazoCancelamentoMin ?? 30;
  if (doc.dataAutorizacao) {
    const minutos = (Date.now() - doc.dataAutorizacao.getTime()) / 60_000;
    if (minutos > prazoMin) {
      throw new Error(
        `O prazo de cancelamento (${prazoMin} min) venceu há ${Math.floor(minutos - prazoMin)} min. ` +
          `Para desfazer a venda agora, emita uma nota de devolução.`,
      );
    }
  }

  const provider = await providerDoTenant(tenantId);
  const r = await provider.cancelarNota({
    externalId: doc.externalId,
    modelo: doc.modelo,
    justificativa,
  });

  await txComTenant(tenantId, async (tx) => {
    if (r.aceito) {
      await tx.fiscalDocument.update({
        where: { id: documentId },
        data: { status: "CANCELADO", protocolo: r.protocolo ?? undefined },
      });
    }
    await tx.fiscalEvent.create({
      data: {
        tenantId,
        documentId,
        tipo: "CANCELAMENTO",
        motivo: justificativa,
        protocolo: r.protocolo,
        codigo: r.codigo,
        mensagem: r.mensagem,
        userId: userId ?? null,
        payload: r.payload === undefined ? undefined : JSON.parse(JSON.stringify(r.payload)),
      },
    });
  });

  return {
    ok: r.aceito,
    protocolo: r.protocolo,
    mensagem: r.aceito
      ? `Nota ${doc.numero}/${doc.serie} cancelada.`
      : (r.mensagem ?? "A SEFAZ recusou o cancelamento."),
  };
}

// ── Carta de correção ───────────────────────────────────────

/**
 * CC-e corrige o que NÃO muda valor, imposto, destinatário nem data. Trocar
 * quantidade ou preço exige cancelar e reemitir.
 *
 * Não existe CC-e para NFC-e (modelo 65) — a SEFAZ só aceita em NF-e.
 */
export async function emitirCartaCorrecao(input: {
  tenantId: string;
  documentId: string;
  correcao: string;
  userId?: string | null;
}): Promise<ResultadoEventoFiscal> {
  const { tenantId, documentId, userId } = input;
  const correcao = validarTexto(input.correcao, "A correção");

  const doc = await txComTenant(tenantId, (tx) =>
    tx.fiscalDocument.findFirst({
      where: { id: documentId },
      select: { id: true, status: true, modelo: true, numero: true, serie: true, externalId: true },
    }),
  );
  if (!doc) throw new Error("Documento fiscal não encontrado.");

  if (doc.modelo === "NFCE") {
    throw new Error(
      "NFC-e não aceita carta de correção. Cancele dentro do prazo ou emita uma nota de devolução.",
    );
  }
  if (doc.status !== "AUTORIZADO") {
    throw new Error("Só nota autorizada aceita carta de correção.");
  }
  if (!doc.externalId) {
    throw new Error("Documento sem referência no provedor.");
  }

  const anteriores = await txComTenant(tenantId, (tx) =>
    tx.fiscalEvent.count({ where: { documentId, tipo: "CARTA_CORRECAO" } }),
  );
  if (anteriores >= MAX_CCE) {
    throw new Error(`Esta nota já teve ${MAX_CCE} cartas de correção — é o limite da SEFAZ.`);
  }
  const sequencia = anteriores + 1;

  const provider = await providerDoTenant(tenantId);
  const r = await provider.cartaCorrecao({
    externalId: doc.externalId,
    modelo: doc.modelo,
    correcao,
    sequencia,
  });

  await txComTenant(tenantId, (tx) =>
    tx.fiscalEvent.create({
      data: {
        tenantId,
        documentId,
        tipo: "CARTA_CORRECAO",
        sequencia,
        motivo: correcao,
        protocolo: r.protocolo,
        codigo: r.codigo,
        mensagem: r.mensagem,
        userId: userId ?? null,
        payload: r.payload === undefined ? undefined : JSON.parse(JSON.stringify(r.payload)),
      },
    }),
  );

  return {
    ok: r.aceito,
    protocolo: r.protocolo,
    mensagem: r.aceito
      ? `Carta de correção ${sequencia} registrada na nota ${doc.numero}/${doc.serie}.`
      : (r.mensagem ?? "A SEFAZ recusou a carta de correção."),
  };
}

// ── Inutilização ────────────────────────────────────────────

/**
 * Queima uma faixa de numeração que nunca virou nota autorizada — o caso
 * clássico é rejeição: o número saiu da série, a nota não existe, e a SEFAZ
 * cobra explicação pelo salto.
 *
 * Recusa se houver nota AUTORIZADA na faixa: inutilizar número usado é
 * declaração falsa, não erro de digitação.
 */
export async function inutilizarFaixa(input: {
  tenantId: string;
  siteId: string;
  modelo: FiscalModelo;
  serie: number;
  numeroInicial: number;
  numeroFinal: number;
  justificativa: string;
  userId?: string | null;
}): Promise<ResultadoEventoFiscal> {
  const { tenantId, siteId, modelo, serie, numeroInicial, numeroFinal, userId } = input;
  const justificativa = validarTexto(input.justificativa, "A justificativa");

  if (numeroInicial < 1 || numeroFinal < numeroInicial) {
    throw new Error("Faixa inválida: o número final tem de ser maior ou igual ao inicial.");
  }

  const emitente = await txComTenant(tenantId, (tx) =>
    tx.fiscalEmitente.findFirst({ where: { siteId }, select: { cnpj: true } }),
  );
  if (!emitente) throw new Error("Esta loja não tem emitente fiscal configurado.");

  const autorizadas = await txComTenant(tenantId, (tx) =>
    tx.fiscalDocument.findMany({
      where: {
        siteId,
        modelo,
        serie,
        numero: { gte: numeroInicial, lte: numeroFinal },
        status: { in: ["AUTORIZADO", "CANCELADO"] },
      },
      select: { numero: true },
      orderBy: { numero: "asc" },
      take: 5,
    }),
  );
  if (autorizadas.length > 0) {
    throw new Error(
      `A faixa contém nota já autorizada (${autorizadas.map((d) => d.numero).join(", ")}). ` +
        `Inutilização só vale para número que nunca virou nota.`,
    );
  }

  const provider = await providerDoTenant(tenantId);
  const r = await provider.inutilizar({
    cnpj: emitente.cnpj,
    modelo,
    serie,
    numeroInicial,
    numeroFinal,
    justificativa,
  });

  await txComTenant(tenantId, async (tx) => {
    if (r.aceito) {
      // Documentos rejeitados naquela faixa passam a INUTILIZADO: o número
      // está resolvido perante a SEFAZ e some da fila de pendências.
      await tx.fiscalDocument.updateMany({
        where: {
          siteId,
          modelo,
          serie,
          numero: { gte: numeroInicial, lte: numeroFinal },
          status: { in: ["REJEITADO", "DENEGADO", "PENDENTE", "CONTINGENCIA"] },
        },
        data: { status: "INUTILIZADO" },
      });
    }
    await tx.fiscalEvent.create({
      data: {
        tenantId,
        tipo: "INUTILIZACAO",
        serie,
        numeroInicial,
        numeroFinal,
        motivo: justificativa,
        protocolo: r.protocolo,
        codigo: r.codigo,
        mensagem: r.mensagem,
        userId: userId ?? null,
        payload: r.payload === undefined ? undefined : JSON.parse(JSON.stringify(r.payload)),
      },
    });
  });

  return {
    ok: r.aceito,
    protocolo: r.protocolo,
    mensagem: r.aceito
      ? `Faixa ${numeroInicial}–${numeroFinal} da série ${serie} inutilizada.`
      : (r.mensagem ?? "A SEFAZ recusou a inutilização."),
  };
}

// ── Arquivos ────────────────────────────────────────────────

/**
 * Busca XML ou DANFE NO PROVEDOR, sob demanda.
 *
 * Não guardamos o arquivo: o provedor já o mantém pelo prazo legal e é a fonte
 * autoritativa. Espelhar em blob storage duplicaria custo e criaria a chance de
 * servir uma versão velha. Quando fizer sentido arquivar (contador exigindo
 * lote mensal), o lugar é um job, não o caminho da tela.
 */
export async function baixarArquivoFiscal(input: {
  tenantId: string;
  documentId: string;
  tipo: "xml" | "pdf";
}): Promise<ArquivoFiscal & { nomeSugerido: string }> {
  const { tenantId, documentId, tipo } = input;

  const doc = await txComTenant(tenantId, (tx) =>
    tx.fiscalDocument.findFirst({
      where: { id: documentId },
      select: { externalId: true, modelo: true, chave: true, numero: true, serie: true, status: true },
    }),
  );
  if (!doc) throw new Error("Documento fiscal não encontrado.");
  if (!doc.externalId) {
    throw new Error("Esta nota ainda não foi transmitida — não há arquivo para baixar.");
  }

  const provider = await providerDoTenant(tenantId);
  const arquivo =
    tipo === "xml"
      ? await provider.baixarXML({ externalId: doc.externalId, modelo: doc.modelo })
      : await provider.baixarPDF({ externalId: doc.externalId, modelo: doc.modelo });

  // Nome pela chave de acesso: é assim que o contador espera receber.
  const base = doc.chave ?? `${doc.modelo.toLowerCase()}-${doc.numero}-${doc.serie}`;
  const ext = arquivo.nomeSugerido.split(".").pop() ?? (tipo === "xml" ? "xml" : "pdf");
  return { ...arquivo, nomeSugerido: `${base}.${ext}` };
}
