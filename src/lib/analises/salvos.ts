import "server-only";
import { db } from "@/lib/prisma";
import { consultaSchema, type Consulta } from "./schema";

/**
 * Relatórios salvos — a consulta que alguém guardou com nome.
 *
 * Duas regras que valem em toda leitura daqui:
 *  1. `findFirst`, nunca `findUnique` — o extension injeta o `tenantId` no
 *     WHERE, e `findUnique` só aceita campos únicos (CLAUDE.md).
 *  2. O DSL gravado é REVALIDADO por Zod ao carregar. Consulta salva com uma
 *     versão antiga do schema some da lista em vez de derrubar o motor.
 */

export type RelatorioSalvo = {
  id: string;
  nome: string;
  descricao: string | null;
  consulta: Consulta;
  ownerUserId: string | null;
  compartilhado: boolean;
  sistema: boolean;
  atualizadoEm: Date;
  /** Quem abriu é o dono? Só o dono renomeia, compartilha e exclui. */
  meu: boolean;
};

/** Quem vê o quê: o meu, o compartilhado pela equipe e o de fábrica. */
function visivelPara(userId: string) {
  return {
    OR: [{ ownerUserId: userId }, { compartilhado: true }, { sistema: true }],
  };
}

export async function listarSalvos(userId: string): Promise<RelatorioSalvo[]> {
  const linhas = await db.savedReport.findMany({
    where: visivelPara(userId),
    orderBy: [{ sistema: "asc" }, { atualizadoEm: "desc" }],
    take: 100,
  });
  return linhas.map((l) => materializar(l, userId)).filter((r): r is RelatorioSalvo => r !== null);
}

export async function abrirSalvo(id: string, userId: string): Promise<RelatorioSalvo | null> {
  const linha = await db.savedReport.findFirst({ where: { id, ...visivelPara(userId) } });
  return linha ? materializar(linha, userId) : null;
}

type LinhaSalva = {
  id: string;
  nome: string;
  descricao: string | null;
  consulta: unknown;
  ownerUserId: string | null;
  compartilhado: boolean;
  sistema: boolean;
  atualizadoEm: Date;
};

function materializar(linha: LinhaSalva, userId: string): RelatorioSalvo | null {
  const parsed = consultaSchema.safeParse(linha.consulta);
  if (!parsed.success) return null;
  return {
    id: linha.id,
    nome: linha.nome,
    descricao: linha.descricao,
    consulta: parsed.data,
    ownerUserId: linha.ownerUserId,
    compartilhado: linha.compartilhado,
    sistema: linha.sistema,
    atualizadoEm: linha.atualizadoEm,
    meu: linha.ownerUserId === userId,
  };
}
