// ============================================================
// Custo efetivo de uma proposta de cotação.
//
// Preço compara duas notas fiscais; não compara duas compras. O que mais muda
// o vencedor é o PRAZO: R$ 100 para pagar em 28 dias custam menos que R$ 100
// à vista, e a diferença é o custo do dinheiro da empresa. O frete, rateado,
// entra junto.
//
// Custo efetivo (por unidade pedida, em R$ de HOJE):
//
//     (preço + frete rateado) ÷ (1 + taxa ao mês)^(dias ÷ 30)
//
// Imposto (ST/IPI) NÃO entra: a cotação deixou de perguntar se o preço o
// inclui (decisão de 16/09/2026). Função pura, sem banco.
// ============================================================

/**
 * Prazo de pagamento em dias médios, a partir do texto livre da proposta.
 *
 *   "à vista", "antecipado", "pix"      → 0
 *   "28", "28 dias", "28d"              → 28
 *   "28/35/42", "28, 35 e 42 dias"      → 35 (média das parcelas)
 *   "30 e 60"                           → 45
 *   "boleto" (sem número)               → null — não dá para saber
 *
 * Número acima de 365 é descartado: é valor em reais digitado no campo errado,
 * não prazo.
 */
export function prazoPagamentoEmDias(texto: string | null | undefined): number | null {
  if (!texto) return null;
  const t = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (/\b(a vista|avista|antecipad[oa]|pix|dinheiro)\b/.test(t) && !/\d/.test(t)) return 0;
  const numeros = (t.match(/\d+/g) ?? []).map(Number).filter((n) => n >= 0 && n <= 365);
  if (numeros.length === 0) {
    return /\b(a vista|avista)\b/.test(t) ? 0 : null;
  }
  // "1+2" / "entrada + 30": a entrada conta como dia 0.
  const comEntrada = /\b(entrada|ato)\b/.test(t) ? [0, ...numeros] : numeros;
  const media = comEntrada.reduce((a, b) => a + b, 0) / comEntrada.length;
  return Math.round(media);
}

export type CondicoesProposta = {
  /** Prazo médio em dias. null = desconhecido → trata como à vista (conservador). */
  prazoPagamentoDias: number | null;
  /** Frete da proposta inteira. */
  frete: number | null;
};

export type LinhaProposta = {
  itemId: string;
  quantidade: number;
  preco: number;
};

export type AvisoCusto = "prazo-desconhecido";

export type CustoLinha = {
  /** Custo efetivo por unidade pedida, em R$ de hoje. */
  unitario: number;
  /** Frete rateado por unidade. */
  freteUnit: number;
  /** Quanto o prazo desconta por unidade (positivo = economia). */
  descontoPrazoUnit: number;
};

export type CustoProposta = {
  linhas: Map<string, CustoLinha>;
  avisos: AvisoCusto[];
};

/** Fator de valor presente: quanto R$ 1 pago daqui a `dias` vale hoje. */
export function fatorPrazo(dias: number | null, taxaMesPct: number): number {
  if (!dias || dias <= 0 || taxaMesPct <= 0) return 1;
  return 1 / Math.pow(1 + taxaMesPct / 100, dias / 30);
}

/**
 * Custo efetivo de cada linha de UMA proposta.
 *
 * O frete é rateado pelo VALOR das linhas que o fornecedor atende: caixa de
 * R$ 200 carrega mais frete que pacote de R$ 5, que é como o distribuidor
 * pensa o frete dele.
 */
export function custoDaProposta(
  linhas: LinhaProposta[],
  condicoes: CondicoesProposta,
  taxaMesPct: number,
): CustoProposta {
  const avisos = new Set<AvisoCusto>();
  const valorTotal = linhas.reduce((a, l) => a + l.preco * l.quantidade, 0);
  const frete = condicoes.frete ?? 0;
  if (condicoes.prazoPagamentoDias === null) avisos.add("prazo-desconhecido");

  const fator = fatorPrazo(condicoes.prazoPagamentoDias, taxaMesPct);
  const saida = new Map<string, CustoLinha>();
  for (const l of linhas) {
    const freteUnit =
      valorTotal > 0 && l.quantidade > 0 ? (frete * ((l.preco * l.quantidade) / valorTotal)) / l.quantidade : 0;
    const bruto = l.preco + freteUnit;
    const unitario = bruto * fator;
    saida.set(l.itemId, { unitario, freteUnit, descontoPrazoUnit: bruto - unitario });
  }
  return { linhas: saida, avisos: [...avisos] };
}

export const TEXTO_AVISO: Record<AvisoCusto, string> = {
  "prazo-desconhecido": "prazo de pagamento não informado — contado como à vista",
};
