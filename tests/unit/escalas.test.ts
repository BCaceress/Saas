import { describe, it, expect } from "vitest";
import {
  LIMITES_PADRAO,
  avaliarFaixa,
  avaliarFaixas,
  melhorOportunidade,
  normalizarFaixas,
  precoNaQuantidade,
  somarOportunidades,
  type ContextoItem,
  type Faixa,
} from "@/lib/compras/escalas";

/**
 * A promoção por volume é a conta mais fácil de errar da compra: a faixa mais
 * barata é sempre a maior, e quem decide no olho troca desconto por capital
 * parado. Estes testes fixam as quatro travas que impedem isso.
 */

const ctx = (over: Partial<ContextoItem> = {}): ContextoItem => ({
  quantidadePedida: 5,
  precoBase: 45,
  fatorEmbalagem: 12,
  consumoDiarioUnidades: 4,
  estoqueAtualUnidades: 0,
  validadeTipicaDias: null,
  ...over,
});

const faixas: Faixa[] = [
  { quantidadeMinima: 10, precoUnitario: 41 },
  { quantidadeMinima: 20, precoUnitario: 39 },
];

describe("normalizarFaixas", () => {
  it("descarta faixa que não passa da quantidade pedida", () => {
    // A faixa de 5 é o próprio pedido — o preço-base já é ela.
    const r = normalizarFaixas(5, 45, [{ quantidadeMinima: 5, precoUnitario: 44 }, ...faixas]);
    expect(r.map((f) => f.quantidadeMinima)).toEqual([10, 20]);
  });

  it("descarta preço que SOBE com o volume — é erro de digitação", () => {
    const r = normalizarFaixas(5, 45, [
      { quantidadeMinima: 10, precoUnitario: 41 },
      { quantidadeMinima: 20, precoUnitario: 47 },
    ]);
    expect(r.map((f) => f.quantidadeMinima)).toEqual([10]);
  });

  it("quantidade repetida fica com o menor preço", () => {
    const r = normalizarFaixas(5, 45, [
      { quantidadeMinima: 10, precoUnitario: 43 },
      { quantidadeMinima: 10, precoUnitario: 41 },
    ]);
    expect(r).toEqual([{ quantidadeMinima: 10, precoUnitario: 41 }]);
  });
});

describe("precoNaQuantidade", () => {
  it("abaixo da primeira faixa vale o preço-base", () => {
    expect(precoNaQuantidade({ quantidadePedida: 5, precoBase: 45 }, faixas, 7).preco).toBe(45);
  });

  it("alcançar a faixa aplica o preço dela", () => {
    const r = precoNaQuantidade({ quantidadePedida: 5, precoBase: 45 }, faixas, 12);
    expect(r.preco).toBe(41);
    expect(r.faixa?.quantidadeMinima).toBe(10);
  });

  it("volume grande cai na faixa mais alta alcançada", () => {
    expect(precoNaQuantidade({ quantidadePedida: 5, precoBase: 45 }, faixas, 25).preco).toBe(39);
  });
});

describe("avaliarFaixa", () => {
  it("economia é a da cesta que eu já ia comprar, não a do volume novo", () => {
    const o = avaliarFaixa(ctx(), faixas[0], LIMITES_PADRAO);
    // 5 caixas × R$ 4,00 de desconto — e não 10 × 4, que creditaria economia
    // em caixas que ninguém tinha decidido comprar.
    expect(o.economia).toBe(20);
    expect(o.economiaSeVenderTudo).toBe(40);
    expect(o.economiaPct).toBeCloseTo(8.89, 1);
  });

  it("investimento extra é o que sai do caixa a mais, hoje", () => {
    const o = avaliarFaixa(ctx(), faixas[0], LIMITES_PADRAO);
    // 10 × 41 = 410 contra 5 × 45 = 225.
    expect(o.investimentoExtra).toBe(185);
  });

  it("cobertura conta a SOBRA em dias de venda", () => {
    // 5 caixas extras × 12 un. = 60 un.; vendendo 4 por dia, 15 dias.
    const o = avaliarFaixa(ctx(), faixas[0], LIMITES_PADRAO);
    expect(o.coberturaExtraDias).toBe(15);
    // Total: 10 × 12 = 120 un. sobre 4 por dia.
    expect(o.coberturaTotalDias).toBe(30);
  });

  it("desconto abaixo do mínimo é recusado", () => {
    const o = avaliarFaixa(ctx(), { quantidadeMinima: 10, precoUnitario: 44.5 }, LIMITES_PADRAO);
    expect(o.recusas).toContain("economia");
    expect(o.compensa).toBe(false);
  });

  it("sobra de estoque acima do teto é recusada", () => {
    const o = avaliarFaixa(ctx({ consumoDiarioUnidades: 0.5 }), faixas[0], LIMITES_PADRAO);
    // 60 un. extras a 0,5 por dia = 120 dias, contra teto de 45.
    expect(o.recusas).toContain("cobertura");
  });

  it("teto de desembolso barra a faixa mesmo com bom desconto", () => {
    const o = avaliarFaixa(ctx(), faixas[1], { ...LIMITES_PADRAO, capitalExtraMax: 300 });
    expect(o.recusas).toContain("capital");
  });

  it("vencer antes de girar barra a promoção", () => {
    const o = avaliarFaixa(ctx({ validadeTipicaDias: 20 }), faixas[0], LIMITES_PADRAO);
    // 30 dias de cobertura total contra 20 de validade típica.
    expect(o.recusas).toContain("validade");
  });

  it("sem histórico de venda, cobertura não opina", () => {
    const o = avaliarFaixa(ctx({ consumoDiarioUnidades: null }), faixas[0], LIMITES_PADRAO);
    expect(o.coberturaExtraDias).toBeNull();
    expect(o.recusas).not.toContain("cobertura");
    expect(o.compensa).toBe(true);
  });
});

describe("melhorOportunidade", () => {
  it("empatando a economia, ganha a MENOR quantidade — menos capital parado", () => {
    const iguais: Faixa[] = [
      { quantidadeMinima: 10, precoUnitario: 41 },
      { quantidadeMinima: 30, precoUnitario: 41 },
    ];
    // Sem histórico para a cobertura não interferir no que o teste mede.
    const o = melhorOportunidade(ctx({ consumoDiarioUnidades: null }), iguais, LIMITES_PADRAO);
    expect(o?.quantidade).toBe(10);
  });

  it("preço menor rende mais e leva, quando as travas deixam", () => {
    const o = melhorOportunidade(ctx({ consumoDiarioUnidades: null }), faixas, LIMITES_PADRAO);
    expect(o?.quantidade).toBe(20);
    expect(o?.precoUnitario).toBe(39);
  });

  it("nenhuma faixa aprovada devolve null, e o motivo fica nas avaliações", () => {
    const apertado = { ...LIMITES_PADRAO, coberturaMaxDias: 1 };
    expect(melhorOportunidade(ctx(), faixas, apertado)).toBeNull();
    expect(avaliarFaixas(ctx(), faixas, apertado).every((o) => !o.compensa)).toBe(true);
  });
});

describe("somarOportunidades", () => {
  it("cobertura do resumo é o PIOR caso, não a média", () => {
    const a = avaliarFaixa(ctx(), faixas[0], LIMITES_PADRAO);
    const b = avaliarFaixa(ctx({ consumoDiarioUnidades: 2 }), faixas[0], LIMITES_PADRAO);
    const r = somarOportunidades([a, b]);
    expect(r.itens).toBe(2);
    expect(r.economia).toBe(40);
    expect(r.investimentoExtra).toBe(370);
    expect(r.maiorCoberturaDias).toBe(60);
  });
});
