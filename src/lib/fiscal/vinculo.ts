// ============================================================
// Melhor palpite para ligar uma linha da nota a um produto do catálogo.
//
// Puro e sem `server-only` de propósito: a mesma regra decide o que a sugestão
// automática grava (no servidor) e o que o formulário de relacionar mostra
// preenchido (no cliente). Duas cópias disso viram dois fatores de conversão
// diferentes para o mesmo fardo — e aí o estoque mente.
// ============================================================

import { fatorDaNota, type ItemComTributavel } from "./fator";

export type ItemParaVinculo = ItemComTributavel & {
  /** cEAN/cEANTrib da linha — pode ser o da unidade OU o do fardo. */
  gtin: string | null;
};

export type ProdutoParaVinculo = {
  ean: string | null;
  packagings: { id: string; ean: string | null; fatorConversao: number }[];
};

export type Vinculo = {
  packagingId: string | null;
  fatorConversao: number;
};

/**
 * Embalagem e fator que o par (item, produto) sugere.
 *
 * A ordem importa. Embalagem cujo código de barras é o da nota ganha de tudo:
 * o fornecedor bipou o fardo, então o fator do fardo é o certo. Só depois vem
 * o que a própria nota declara em qCom/qTrib. Cair em 1 é o último recurso —
 * e é o caso que a tela precisa marcar como "chutei".
 */
export function inferirVinculo(produto: ProdutoParaVinculo, item: ItemParaVinculo): Vinculo {
  const pelaEmbalagem = item.gtin
    ? (produto.packagings.find((pk) => pk.ean && pk.ean === item.gtin) ?? null)
    : null;

  return {
    packagingId: pelaEmbalagem?.id ?? null,
    fatorConversao: pelaEmbalagem?.fatorConversao ?? fatorDaNota(item) ?? 1,
  };
}

/** O código de barras da nota é de alguma coisa deste produto? */
export function casaPorCodigo(produto: ProdutoParaVinculo, gtin: string | null): boolean {
  if (!gtin) return false;
  return produto.ean === gtin || produto.packagings.some((pk) => pk.ean === gtin);
}

/**
 * De onde saiu o fator que está gravado. A tela precisa distinguir "veio do
 * cadastro" de "chutei 1 porque ninguém me disse" — o segundo é o que estoura
 * o estoque em silêncio.
 */
export type OrigemFator = "CADASTRO" | "NOTA" | "MANUAL" | "SEM_CONVERSAO";

export function origemDoFator(item: {
  packagingId: string | null;
  fatorConversao: number;
  quantidade: number;
  unidadeTributavel: string | null;
  quantidadeTributavel: number | null;
}): OrigemFator {
  if (item.packagingId) return "CADASTRO";
  if (item.fatorConversao === 1) return "SEM_CONVERSAO";
  return fatorDaNota(item) === item.fatorConversao ? "NOTA" : "MANUAL";
}
