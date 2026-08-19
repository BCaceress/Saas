/**
 * Rateio dos totais da NF-e que o fornecedor não lançou item a item.
 *
 * O certo é `ICMSTot.vFrete` ser a soma dos `prod.vFrete`, e na maioria das
 * notas é. Mas muito emitente lança o frete só no total e deixa os itens
 * zerados — aí o custo da mercadoria entra menor do que foi pago, o custo
 * médio fica errado e a margem da venda mente para cima. É um erro silencioso:
 * ninguém percebe até fechar o mês.
 *
 * Por isso o rateio é da DIFERENÇA, nunca do total: se os itens já somam o
 * frete do cabeçalho, não há o que distribuir (somar de novo cobraria o frete
 * duas vezes).
 *
 * Módulo puro, sem banco — é a regra que os testes protegem.
 */

export type LinhaRateio = {
  /** vProd da linha: a base da proporção. */
  valorTotal: number;
  valorFrete: number;
  valorDesconto: number;
  /** Bonificação entra com custo zero, então não carrega frete nem desconto. */
  bonificacao: boolean;
};

export type TotaisNota = {
  /** ICMSTot.vFrete */
  frete: number;
  /** ICMSTot.vDesc */
  desconto: number;
};

const cent = (v: number) => Math.round(v * 100) / 100;

/**
 * Devolve, por linha, o frete e o desconto efetivos (o que veio na linha +
 * a parte que sobrou do cabeçalho). A ordem das linhas é preservada.
 */
export function ratearTotaisDaNota<T extends LinhaRateio>(
  linhas: T[],
  totais: TotaisNota,
): { valorFrete: number; valorDesconto: number }[] {
  const base = linhas.map((l) => ({
    valorFrete: cent(l.valorFrete),
    valorDesconto: cent(l.valorDesconto),
  }));

  distribuir(
    linhas,
    base,
    "valorFrete",
    cent(totais.frete) - cent(linhas.reduce((s, l) => s + l.valorFrete, 0)),
  );
  distribuir(
    linhas,
    base,
    "valorDesconto",
    cent(totais.desconto) - cent(linhas.reduce((s, l) => s + l.valorDesconto, 0)),
  );

  return base;
}

function distribuir<T extends LinhaRateio>(
  linhas: T[],
  saida: { valorFrete: number; valorDesconto: number }[],
  campo: "valorFrete" | "valorDesconto",
  resto: number,
): void {
  // Diferença de centavo é arredondamento do emitente, não frete escondido.
  if (resto <= 0.01) return;

  // Elegíveis: linhas com valor e sem bonificação. Ratear no brinde jogaria
  // custo em quem entra de graça e tiraria custo de quem foi pago.
  const elegiveis = linhas
    .map((l, i) => ({ i, peso: l.bonificacao ? 0 : Math.max(0, l.valorTotal) }))
    .filter((e) => e.peso > 0);

  const somaPesos = elegiveis.reduce((s, e) => s + e.peso, 0);
  if (somaPesos <= 0) return;

  let distribuido = 0;
  for (const [n, e] of elegiveis.entries()) {
    const ultima = n === elegiveis.length - 1;
    // A última linha leva a sobra do arredondamento: assim a soma fecha exata
    // com o total da nota, que é o número que o operador confere.
    const parte = ultima ? cent(resto - distribuido) : cent((resto * e.peso) / somaPesos);
    distribuido = cent(distribuido + parte);
    saida[e.i][campo] = cent(saida[e.i][campo] + parte);
  }
}
