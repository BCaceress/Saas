import "server-only";
import { db } from "@/lib/prisma";
import { getRelatorio } from "./catalogo";

/**
 * Favoritos da Central — a prateleira de cima de cada pessoa.
 *
 * Favorito é POR USUÁRIO dentro do tenant: o que o comprador acompanha não é o
 * que o caixa acompanha. `relatorioId` é o slug do catálogo em código, então
 * relatório aposentado some da tela sem quebrar nada (a leitura descarta id
 * desconhecido em vez de devolver card fantasma).
 */

export async function listarFavoritos(userId: string): Promise<string[]> {
  const linhas = await db.reportFavorite.findMany({
    where: { userId },
    select: { relatorioId: true },
    orderBy: { criadoEm: "asc" },
    take: 100,
  });
  return linhas.map((l) => l.relatorioId).filter((id) => getRelatorio(id));
}

/** Liga/desliga e devolve o estado final. */
export async function alternarFavorito(
  tenantId: string,
  userId: string,
  relatorioId: string,
): Promise<boolean> {
  const removidos = await db.reportFavorite.deleteMany({ where: { userId, relatorioId } });
  if (removidos.count > 0) return false;

  await db.reportFavorite.create({ data: { tenantId, userId, relatorioId } });
  return true;
}
