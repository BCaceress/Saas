import "server-only";
import { db } from "./prisma";

/**
 * Leituras de giro usadas pelo modo ROTATIVIDADE. Ficam fora de
 * `estoque-estrategia.ts` porque aquele módulo também roda no client.
 */

/**
 * Dias desde a primeira saída de estoque registrada — é o "tamanho" do
 * histórico que a empresa tem. null = ainda não vendeu nada.
 * Roda dentro do contexto de tenant (usa `db`).
 */
export async function diasDeHistoricoVendas(siteId?: string | null): Promise<number | null> {
  const primeira = await db.stockMovement.findFirst({
    where: { tipo: "SAIDA", ...(siteId ? { siteId } : {}) },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  if (!primeira) return null;
  return Math.floor((Date.now() - primeira.createdAt.getTime()) / 864e5);
}

/**
 * Consumo (unidades que saíram) por produto na janela informada.
 * Considera saída fechada e, na falta dela, a aberta — mesma regra do
 * cálculo de reposição.
 */
export async function consumoPorProduto(
  janelaDias: number,
  opts: { productIds?: string[]; siteId?: string | null } = {},
): Promise<Map<string, number>> {
  const desde = new Date(Date.now() - janelaDias * 864e5);
  const movs = await db.stockMovement.findMany({
    where: {
      tipo: "SAIDA",
      createdAt: { gte: desde },
      ...(opts.productIds ? { productId: { in: opts.productIds } } : {}),
      ...(opts.siteId ? { siteId: opts.siteId } : {}),
    },
    select: { productId: true, deltaFechado: true, deltaAberto: true },
  });
  const mapa = new Map<string, number>();
  for (const m of movs) {
    const q = Math.abs(Number(m.deltaFechado ?? 0)) || Math.abs(Number(m.deltaAberto ?? 0));
    if (q <= 0) continue;
    mapa.set(m.productId, (mapa.get(m.productId) ?? 0) + q);
  }
  return mapa;
}

/** Chave do consumo por ponto de estoque. */
export const chaveProdutoSite = (productId: string, siteId: string | null) =>
  `${productId}:${siteId ?? "-"}`;

/**
 * Consumo por produto E ponto de estoque, em uma consulta só.
 *
 * O sino precisa disso porque cobertura é por prateleira: somar a venda das
 * três lojas e dividir pelo saldo de uma delas dá um número que não existe em
 * lugar nenhum. Uma chamada por loja resolveria também, ao custo de N
 * consultas — daí a chave composta.
 */
export async function consumoPorProdutoSite(
  janelaDias: number,
): Promise<Map<string, number>> {
  const desde = new Date(Date.now() - janelaDias * 864e5);
  const movs = await db.stockMovement.findMany({
    where: { tipo: "SAIDA", createdAt: { gte: desde } },
    select: { productId: true, siteId: true, deltaFechado: true, deltaAberto: true },
  });
  const mapa = new Map<string, number>();
  for (const m of movs) {
    const q = Math.abs(Number(m.deltaFechado ?? 0)) || Math.abs(Number(m.deltaAberto ?? 0));
    if (q <= 0) continue;
    const k = chaveProdutoSite(m.productId, m.siteId);
    mapa.set(k, (mapa.get(k) ?? 0) + q);
  }
  return mapa;
}
