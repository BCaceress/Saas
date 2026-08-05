import "server-only";
import { db } from "@/lib/prisma";
import { getRelatorio, type Parametros } from "./catalogo";
import type { ReportConfig } from "./config";

/**
 * Histórico de execução — o que dá à Central a noção de uso.
 *
 * Duas leituras saem daqui: a AGREGADA (quantas vezes cada relatório rodou e
 * quando foi a última), que ordena "mais utilizados" e preenche o rodapé do
 * card; e a CRONOLÓGICA, que é a prateleira "executados recentemente".
 *
 * Guarda parâmetro, nunca resultado: relatório é pergunta, não fotografia —
 * reabrir do histórico tem de trazer o dado de hoje.
 */

export type FormatoExecucao = "tela" | "csv" | "xlsx" | "pdf" | "impressao";

/**
 * O que foi pedido na execução. Duas formas convivem: a `ReportConfig` do
 * motor genérico (colunas, ordem, agrupamento) e os `Parametros` antigos dos
 * relatórios que ainda abrem em tela dedicada. Quem lê distingue pelo campo
 * `colunas` — ver `ultimaConfig` em `modelos-salvos.ts`.
 */
export type ParametrosExecucao = Parametros | ReportConfig;

export async function registrarExecucao(args: {
  tenantId: string;
  userId: string;
  relatorioId: string;
  parametros: ParametrosExecucao;
  formato: FormatoExecucao;
  duracaoMs?: number;
}): Promise<void> {
  await db.reportRun.create({
    data: {
      tenantId: args.tenantId,
      userId: args.userId,
      relatorioId: args.relatorioId,
      parametros: args.parametros,
      formato: args.formato,
      duracaoMs: args.duracaoMs ?? null,
    },
  });
}

export type UsoRelatorio = { execucoes: number; ultimaEm: Date | null };

/**
 * Uso por relatório, no tenant inteiro. É de propósito: "mais utilizados" fala
 * do que a LOJA consulta, não do que esta pessoa consultou — quem chega novo na
 * equipe já encontra a prateleira arrumada.
 */
export async function usoPorRelatorio(): Promise<Record<string, UsoRelatorio>> {
  const linhas = await db.reportRun.groupBy({
    by: ["relatorioId"],
    _count: { _all: true },
    _max: { criadoEm: true },
  });

  const saida: Record<string, UsoRelatorio> = {};
  for (const l of linhas) {
    if (!getRelatorio(l.relatorioId)) continue;
    saida[l.relatorioId] = { execucoes: l._count._all, ultimaEm: l._max.criadoEm };
  }
  return saida;
}

export type ExecucaoRecente = {
  id: string;
  relatorioId: string;
  nome: string;
  formato: string;
  criadoEm: Date;
  /** Quem rodou — null quando o usuário saiu da equipe. */
  userId: string | null;
};

export async function execucoesRecentes(limite = 12): Promise<ExecucaoRecente[]> {
  const linhas = await db.reportRun.findMany({
    orderBy: { criadoEm: "desc" },
    take: Math.min(limite * 3, 90),
    select: { id: true, relatorioId: true, formato: true, criadoEm: true, userId: true },
  });

  // Uma linha por relatório: o histórico é "o que a loja andou olhando", e vinte
  // execuções seguidas do mesmo relatório empurrariam o resto para fora da tela.
  const vistos = new Set<string>();
  const saida: ExecucaoRecente[] = [];
  for (const l of linhas) {
    const rel = getRelatorio(l.relatorioId);
    if (!rel || vistos.has(l.relatorioId)) continue;
    vistos.add(l.relatorioId);
    saida.push({
      id: l.id,
      relatorioId: l.relatorioId,
      nome: rel.nome,
      formato: l.formato,
      criadoEm: l.criadoEm,
      userId: l.userId,
    });
    if (saida.length >= limite) break;
  }
  return saida;
}
