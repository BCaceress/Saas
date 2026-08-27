// ============================================================
// Quantas unidades de prateleira cabem na unidade de venda do fornecedor.
//
// Puro de propósito: a mesma regra decide o fator na importação do XML (no
// servidor) e o que a tela de conciliação sugere ao operador (no cliente). Duas
// cópias da regra viram, cedo ou tarde, dois estoques diferentes.
// ============================================================

import { unidadeContinua } from "./unidades";

export type ItemComTributavel = {
  /** qCom — quantidade na unidade de venda. */
  quantidade: number;
  /** uTrib — unidade tributável. */
  unidadeTributavel: string | null;
  /** qTrib — quantidade na unidade tributável. */
  quantidadeTributavel: number | null;
};

/**
 * Fator que a PRÓPRIA NOTA declara.
 *
 * O distribuidor de bebida vende em caixa e tributa em unidade: `qCom` 5 cx e
 * `qTrib` 120 un é um fator 24 assinado digitalmente pelo fornecedor — melhor
 * palpite que existe para um item que ainda não tem de-para, e de graça.
 *
 * Só devolve valor quando o resultado é inteiro ≥ 2: fração é sinal de que os
 * dois campos não falam da mesma coisa, e aí 1 (a nota como veio) erra menos.
 * `null` significa "a nota não ajuda aqui", não "o fator é 1".
 */
export function fatorDaNota(item: ItemComTributavel): number | null {
  const { quantidade: qCom, quantidadeTributavel: qTrib, unidadeTributavel: uTrib } = item;
  if (!qTrib || qCom <= 0 || qTrib <= 0) return null;
  // Se a nota tributa em KG ou L, a razão qTrib/qCom é peso por caixa, não
  // peça por caixa — usar aquilo como fator colocaria "8,4" garrafas no saldo.
  if (unidadeContinua(uTrib)) return null;

  const bruto = qTrib / qCom;
  const inteiro = Math.round(bruto);
  return inteiro >= 2 && Math.abs(bruto - inteiro) < 1e-6 ? inteiro : null;
}
