import "server-only";
import { db } from "@/lib/prisma";
import { normalizarConfig, type ReportConfig } from "./config";
import type { ReportDefinition } from "./definicao";

/**
 * Modelos salvos e padrão pessoal.
 *
 * Duas formas de não reconfigurar o mesmo relatório toda semana:
 *
 *  · **Modelo** (`ReportPreset`) — configuração batizada: "Relatório do
 *    contador", "resumido da loja". Fica na lista, pode ser compartilhado com a
 *    equipe e sobrevive a quem o criou.
 *  · **Padrão pessoal** — o mesmo `ReportPreset`, com o nome reservado
 *    `NOME_PADRAO`. É o que "Visualizar" e "Exportar" usam sem perguntar nada.
 *    Não aparece na lista de modelos: ele não é uma opção, é o ponto de partida.
 *
 * O nome reservado é o índice único que já existe (`tenant + relatório + dono +
 * nome`) fazendo o trabalho de "um padrão por pessoa por relatório" — sem
 * coluna nova e sem migration.
 *
 * Os dois passam por `normalizarConfig` na leitura: um modelo de janeiro pode
 * citar uma coluna que o relatório não tem mais, e isso não pode quebrar a tela.
 */

/** Nome reservado do padrão pessoal. Nome de modelo é validado (min 2, sem `_`
 *  no começo não é regra) — o prefixo duplo evita colisão com nome de gente. */
export const NOME_PADRAO = "__padrao__";

export type ModeloSalvo = {
  id: string;
  nome: string;
  config: ReportConfig;
  meu: boolean;
  compartilhado: boolean;
};

/** Modelos que esta pessoa enxerga: os dela e os que a equipe compartilhou. */
export async function listarModelos(
  def: ReportDefinition,
  userId: string,
): Promise<ModeloSalvo[]> {
  const linhas = await db.reportPreset.findMany({
    where: {
      relatorioId: def.id,
      nome: { not: NOME_PADRAO },
      OR: [{ ownerUserId: userId }, { compartilhado: true }],
    },
    orderBy: [{ compartilhado: "asc" }, { nome: "asc" }],
    take: 60,
    select: { id: true, nome: true, config: true, ownerUserId: true, compartilhado: true },
  });

  return linhas.map((m) => ({
    id: m.id,
    nome: m.nome,
    config: normalizarConfig(def, m.config),
    meu: m.ownerUserId === userId,
    compartilhado: m.compartilhado,
  }));
}

export async function salvarModelo(args: {
  tenantId: string;
  userId: string;
  relatorioId: string;
  nome: string;
  config: ReportConfig;
  compartilhado: boolean;
}): Promise<{ id: string }> {
  // Salvar com o mesmo nome sobrescreve o próprio modelo em vez de criar um
  // gêmeo — é o que o operador espera de "salvar".
  const existente = await db.reportPreset.findFirst({
    where: { relatorioId: args.relatorioId, ownerUserId: args.userId, nome: args.nome },
    select: { id: true },
  });

  if (existente) {
    await db.reportPreset.updateMany({
      where: { id: existente.id, ownerUserId: args.userId },
      data: { config: args.config, compartilhado: args.compartilhado },
    });
    return existente;
  }

  return db.reportPreset.create({
    data: {
      tenantId: args.tenantId,
      relatorioId: args.relatorioId,
      nome: args.nome,
      config: args.config,
      ownerUserId: args.userId,
      compartilhado: args.compartilhado,
    },
    select: { id: true },
  });
}

/** Só o dono apaga o que é dele — o WHERE é a autorização. */
export async function excluirModelo(id: string, userId: string): Promise<boolean> {
  const { count } = await db.reportPreset.deleteMany({ where: { id, ownerUserId: userId } });
  return count > 0;
}

/**
 * O padrão pessoal desta pessoa para este relatório. `null` quando ela nunca
 * salvou um — aí vale o padrão da definição (`configPadrao`).
 *
 * Não usamos "a última execução" de propósito: o novo fluxo promete que
 * Visualizar e Exportar saem SEMPRE iguais. Um relatório que muda sozinho
 * porque alguém mexeu nele semana passada quebra essa promessa.
 */
export async function configPadraoDoUsuario(
  def: ReportDefinition,
  userId: string,
): Promise<ReportConfig | null> {
  const linha = await db.reportPreset.findFirst({
    where: { relatorioId: def.id, ownerUserId: userId, nome: NOME_PADRAO },
    select: { config: true },
  });
  return linha ? normalizarConfig(def, linha.config) : null;
}

/** Grava (ou substitui) o padrão pessoal. Nunca é compartilhado com a equipe. */
export function salvarPadrao(args: {
  tenantId: string;
  userId: string;
  relatorioId: string;
  config: ReportConfig;
}): Promise<{ id: string }> {
  return salvarModelo({ ...args, nome: NOME_PADRAO, compartilhado: false });
}

/** Volta ao padrão da definição: apaga o padrão pessoal, se houver. */
export async function limparPadrao(relatorioId: string, userId: string): Promise<void> {
  await db.reportPreset.deleteMany({
    where: { relatorioId, ownerUserId: userId, nome: NOME_PADRAO },
  });
}
