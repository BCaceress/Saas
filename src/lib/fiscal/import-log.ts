import "server-only";
import { db } from "@/lib/prisma";
import { requireTenantId } from "@/lib/tenant-context";
import type { FiscalImportOrigem, FiscalImportStatus } from "@/generated/prisma";
import type { ResultadoImportacao } from "./entrada";

// ============================================================
// Trilha de importação de NF-e.
//
// Toda porta de entrada (upload, e-mail, SEFAZ) passa por aqui depois de
// chamar `importarNotasXml`. O log existe para responder a pergunta que o
// operador faz quando a nota "não aparece": ela chegou e foi recusada por já
// existir? veio como PDF? o XML estava quebrado? Sem isto, o silêncio da
// automação é indistinguível de falha.
//
// Escrever no log NUNCA pode derrubar a importação — a nota já entrou no
// estoque nesse ponto. Por isso tudo aqui é best-effort.
// ============================================================

const STATUS: Record<ResultadoImportacao["status"], FiscalImportStatus> = {
  IMPORTADA: "IMPORTADA",
  DUPLICADA: "DUPLICADA",
  ERRO: "ERRO",
};

export type ContextoImportacao = {
  origem: FiscalImportOrigem;
  siteId?: string | null;
  inboxId?: string | null;
  remetente?: string | null;
  usuarioId?: string | null;
};

/** Uma linha por arquivo processado, com o veredito de `importarNotasXml`. */
export async function registrarImportacoes(
  ctx: ContextoImportacao,
  resultados: ResultadoImportacao[],
): Promise<void> {
  if (resultados.length === 0) return;

  await gravar(
    resultados.map((r) => ({
      origem: ctx.origem,
      siteId: ctx.siteId ?? null,
      inboxId: ctx.inboxId ?? null,
      remetente: ctx.remetente ?? null,
      usuarioId: ctx.usuarioId ?? null,
      status: STATUS[r.status],
      arquivo: r.arquivo,
      chave: r.chave ?? null,
      inboundId: r.inboundId ?? null,
      mensagem: mensagemDe(r),
    })),
  );
}

/** Arquivo que nem chegou ao parser (PDF, boleto, anexo sem XML). */
export async function registrarIgnorado(
  ctx: ContextoImportacao,
  arquivo: string,
  motivo: string,
): Promise<void> {
  await gravar([
    {
      origem: ctx.origem,
      siteId: ctx.siteId ?? null,
      inboxId: ctx.inboxId ?? null,
      remetente: ctx.remetente ?? null,
      usuarioId: ctx.usuarioId ?? null,
      status: "IGNORADA" as FiscalImportStatus,
      arquivo,
      chave: null,
      inboundId: null,
      mensagem: motivo,
    },
  ]);
}

/** Falha do canal inteiro (IMAP fora do ar, certificado vencido, SEFAZ mudo). */
export async function registrarFalhaCanal(
  ctx: ContextoImportacao,
  mensagem: string,
): Promise<void> {
  await gravar([
    {
      origem: ctx.origem,
      siteId: ctx.siteId ?? null,
      inboxId: ctx.inboxId ?? null,
      remetente: ctx.remetente ?? null,
      usuarioId: ctx.usuarioId ?? null,
      status: "ERRO" as FiscalImportStatus,
      arquivo: null,
      chave: null,
      inboundId: null,
      mensagem,
    },
  ]);
}

function mensagemDe(r: ResultadoImportacao): string | null {
  if (r.status === "ERRO") return r.motivo ?? "Falha ao ler o arquivo.";
  if (r.status === "DUPLICADA") return r.motivo ?? "Esta nota já havia sido importada.";
  const partes: string[] = [];
  if (r.itensTotal != null) {
    partes.push(`${r.itensResolvidos ?? 0}/${r.itensTotal} itens relacionados`);
  }
  if (r.pedidoNumero) partes.push(`conciliada com ${r.pedidoNumero}`);
  else if (r.pedidosCandidatos) partes.push(`${r.pedidosCandidatos} pedidos candidatos`);
  return partes.length > 0 ? partes.join(" · ") : null;
}

type LinhaLog = {
  origem: FiscalImportOrigem;
  status: FiscalImportStatus;
  siteId: string | null;
  inboxId: string | null;
  remetente: string | null;
  usuarioId: string | null;
  arquivo: string | null;
  chave: string | null;
  inboundId: string | null;
  mensagem: string | null;
};

async function gravar(linhas: LinhaLog[]): Promise<void> {
  try {
    const tenantId = requireTenantId();
    await db.fiscalImportLog.createMany({
      data: linhas.map((l) => ({
        ...l,
        tenantId,
        mensagem: l.mensagem?.slice(0, 500) ?? null,
      })),
    });
  } catch {
    // Auditoria não pode virar o motivo de a mercadoria não entrar.
  }
}

export type LinhaHistorico = {
  id: string;
  origem: FiscalImportOrigem;
  status: FiscalImportStatus;
  arquivo: string | null;
  chave: string | null;
  mensagem: string | null;
  remetente: string | null;
  inboundId: string | null;
  processadoEm: string;
};

/** Histórico para a tela de configuração — os últimos arquivos de todos os canais. */
export async function listarImportacoes(opcoes?: {
  limite?: number;
  origem?: FiscalImportOrigem;
}): Promise<LinhaHistorico[]> {
  const linhas = await db.fiscalImportLog.findMany({
    where: opcoes?.origem ? { origem: opcoes.origem } : undefined,
    orderBy: { processadoEm: "desc" },
    take: Math.min(opcoes?.limite ?? 50, 200),
    select: {
      id: true,
      origem: true,
      status: true,
      arquivo: true,
      chave: true,
      mensagem: true,
      remetente: true,
      inboundId: true,
      processadoEm: true,
    },
  });

  return linhas.map((l) => ({ ...l, processadoEm: l.processadoEm.toISOString() }));
}
