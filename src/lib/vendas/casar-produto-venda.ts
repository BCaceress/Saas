import { db } from "@/lib/prisma";
import { pontuarProduto, type ProdutoRanqueavel } from "@/lib/compras/busca-produto-rank";

/**
 * Casamento de nome de produto vindo de um sistema antigo → produto do catálogo.
 * Usa o mesmo ranqueador do vínculo de nota fiscal. Compartilhado pelos dois
 * formatos de importação de histórico (CSV item-a-item e planilha de transações).
 */

const PONTOS_MINIMOS_PARA_CASAR = 60;

export type ProdutoCasado = {
  id: string;
  nome: string;
  /** Preço de venda atual — peso do rateio quando o arquivo não traz preço por item. */
  precoVenda: number;
};

export type CasadorDeProdutos = (nomeOrigem: string) => ProdutoCasado | null;

/** Carrega o catálogo do tenant uma vez e devolve um casador com cache por nome. */
export async function criarCasadorDeProdutos(): Promise<CasadorDeProdutos> {
  const produtos = await db.product.findMany({
    where: { ativo: true },
    select: {
      id: true,
      nome: true,
      sku: true,
      ean: true,
      precoVenda: true,
      packagings: { select: { ean: true } },
    },
  });

  const ranqueaveis: (ProdutoRanqueavel & ProdutoCasado)[] = produtos.map((p) => ({
    id: p.id,
    nome: p.nome,
    sku: p.sku,
    ean: p.ean,
    embalagens: p.packagings,
    precoVenda: p.precoVenda == null ? 0 : Number(p.precoVenda),
  }));

  const cache = new Map<string, ProdutoCasado | null>();

  return function casar(nomeOrigem: string): ProdutoCasado | null {
    const termo = nomeOrigem.trim();
    if (!termo) return null;
    if (cache.has(termo)) return cache.get(termo)!;

    let melhor: { p: ProdutoCasado; pontos: number } | null = null;
    for (const p of ranqueaveis) {
      const pontos = pontuarProduto(p, termo);
      if (!melhor || pontos > melhor.pontos) melhor = { p, pontos };
    }

    const resultado =
      melhor && melhor.pontos >= PONTOS_MINIMOS_PARA_CASAR
        ? { id: melhor.p.id, nome: melhor.p.nome, precoVenda: melhor.p.precoVenda }
        : null;
    cache.set(termo, resultado);
    return resultado;
  };
}
