import type { ReconciliationStatus } from "@/generated/prisma";

// ============================================================
// As regras de comparação da conciliação — puras, sem I/O.
//
// Separadas do serviço pelo mesmo motivo que `fiscal/fator.ts`: o veredito de
// uma linha ("faltou", "mudou de preço") é a parte que precisa estar CERTA, e
// certeza aqui se prova com teste, não com clique na tela.
//
// Tudo em UNIDADE BASE do estoque: converter é responsabilidade de quem chama.
// ============================================================

/** Quantidade é contagem: meia unidade de diferença não existe. */
export const TOL_QTD = 0.001;
/** Diferença de custo abaixo disso é arredondamento de rateio, não preço novo. */
export const TOL_CUSTO_ABS = 0.005;
export const TOL_CUSTO_REL = 0.005;

/**
 * Termo com que a busca de produto abre ao relacionar um item da nota: o NOME
 * do item, como o fornecedor escreveu.
 *
 * Só as primeiras palavras. A descrição da NF-e termina em embalagem e lastro
 * ("CERV HEINEKEN LN 330ML CX C/24") e a linha inteira não casa com nada no
 * catálogo — enquanto "CERV HEINEKEN LN" casa. SKU e código de barras seguem
 * valendo na mesma caixa: quem digita, busca.
 */
export function termoDeBuscaDoItem(descricao: string): string {
  return descricao.trim().split(/\s+/).slice(0, 3).join(" ").slice(0, 30);
}

/** O custo faturado difere do negociado a ponto de exigir decisão do operador? */
export function custoMudou(custoPedido: number, custoFaturado: number): boolean {
  // Sem preço negociado (bonificação, item fora do pedido) não há comparação.
  if (custoPedido <= 0) return false;
  const dif = Math.abs(custoFaturado - custoPedido);
  return dif > TOL_CUSTO_ABS && dif / custoPedido > TOL_CUSTO_REL;
}

/** Variação percentual do custo. `null` quando não há o que comparar. */
export function variacaoCusto(custoPedido: number, custoFaturado: number): number | null {
  if (custoPedido <= 0) return null;
  const v = ((custoFaturado - custoPedido) / custoPedido) * 100;
  return Math.abs(v) < 0.01 ? null : v;
}

/**
 * Veredito de uma linha que tem os dois lados (pedido e nota).
 *
 * Quantidade vem antes de preço de propósito: faltar mercadoria é um problema
 * de outra ordem que pagar 9% a mais por ela, e a tela só mostra um selo.
 */
export function vereditoDaLinha(l: {
  qtdPedida: number;
  qtdFaturada: number;
  custoPedido: number;
  custoFaturado: number;
}): ReconciliationStatus {
  const dif = l.qtdFaturada - l.qtdPedida;
  if (dif < -TOL_QTD) return "FALTANDO";
  if (dif > TOL_QTD) return "EXCEDENTE";
  if (custoMudou(l.custoPedido, l.custoFaturado)) return "PRECO_ALTERADO";
  return "OK";
}
