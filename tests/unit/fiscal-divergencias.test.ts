import { describe, it, expect } from "vitest";
import {
  bloqueia,
  divergenciasDoItem,
  type ItemParaDivergencia,
  type ProdutoParaDivergencia,
} from "@/lib/fiscal/divergencias";

/**
 * A régua que decide quando interromper o operador. Errar para o lado frouxo
 * põe caixa como unidade no estoque; errar para o lado apertado faz a pessoa
 * confirmar quarenta linhas que estavam certas. Os dois custam caro.
 */

const item = (over: Partial<ItemParaDivergencia> = {}): ItemParaDivergencia => ({
  gtin: "7891000315507",
  ncm: "22030000",
  unidade: "CX",
  quantidade: 5,
  unidadeTributavel: "UN",
  quantidadeTributavel: 120,
  fatorConversao: 24,
  packagingId: "pk1",
  bonificacao: false,
  custoLinha: 1200,
  ...over,
});

const produto = (over: Partial<ProdutoParaDivergencia> = {}): ProdutoParaDivergencia => ({
  id: "p1",
  nome: "Corona Extra Long Neck 330ml",
  ean: "7891000000000",
  ncm: "22030000",
  custoMedio: 10,
  packagings: [
    { id: "pk1", nome: "Caixa", ean: "7891000315507", fatorConversao: 24 },
  ],
  ...over,
});

const tipos = (ds: { tipo: string }[]) => ds.map((d) => d.tipo).sort();

describe("divergenciasDoItem", () => {
  it("cala a boca quando a nota fecha com o cadastro", () => {
    expect(divergenciasDoItem(item(), produto())).toEqual([]);
  });

  it("não opina sobre linha que ainda não virou produto", () => {
    // Ali o trabalho é relacionar; aviso sobre produto que ninguém escolheu
    // só empurra ruído para a etapa errada.
    expect(divergenciasDoItem(item(), null)).toEqual([]);
  });

  it("bloqueia quando o fator do cadastro não é o que a nota declara", () => {
    // Cadastro diz 24 por caixa; esta nota fatura 5 cx e tributa 60 un → 12.
    const d = divergenciasDoItem(item({ quantidadeTributavel: 60 }), produto());
    expect(tipos(d)).toContain("FATOR_DIVERGENTE");
    expect(bloqueia(d)).toBe(true);
  });

  it("bloqueia a conversão nunca confirmada — caixa entrando como unidade", () => {
    const d = divergenciasDoItem(
      // Sem embalagem no de-para, fator 1, e a nota vende em CX.
      item({ packagingId: null, fatorConversao: 1, quantidadeTributavel: null }),
      produto({ custoMedio: 0 }),
    );
    expect(tipos(d)).toContain("FATOR_CHUTADO");
    expect(bloqueia(d)).toBe(true);
  });

  it("não chama de chute a nota que já vem na unidade de prateleira", () => {
    const d = divergenciasDoItem(
      item({ unidade: "UN", packagingId: null, fatorConversao: 1, quantidadeTributavel: null }),
      produto({ custoMedio: 0 }),
    );
    expect(tipos(d)).not.toContain("FATOR_CHUTADO");
  });

  it("bloqueia código de barras que já é de outro produto", () => {
    const d = divergenciasDoItem(item(), produto(), {
      productId: "p2",
      nome: "Heineken Long Neck",
      sku: "BEB-CER-0042",
      onde: "o produto",
    });
    expect(tipos(d)).toContain("GTIN_DE_OUTRO");
    expect(bloqueia(d)).toBe(true);
  });

  it("apenas avisa sobre código de barras que ninguém usa ainda", () => {
    const d = divergenciasDoItem(item({ gtin: "7899999999999" }), produto());
    expect(tipos(d)).toContain("GTIN_NOVO");
    expect(bloqueia(d)).toBe(false);
  });

  it("avisa sobre custo fora da curva sem travar a conferência", () => {
    // 1200 / (5 × 24) = 10 por unidade contra custo médio de 5 → +100%.
    const d = divergenciasDoItem(item(), produto({ custoMedio: 5 }));
    expect(tipos(d)).toContain("CUSTO_FORA_DA_CURVA");
    expect(bloqueia(d)).toBe(false);
  });

  it("não cobra custo de bonificação — mercadoria de graça não tem preço", () => {
    const d = divergenciasDoItem(
      item({ bonificacao: true, custoLinha: 0 }),
      produto({ custoMedio: 5 }),
    );
    expect(tipos(d)).not.toContain("CUSTO_FORA_DA_CURVA");
  });

  it("trata NCM diferente como assunto do contador, não do operador", () => {
    const d = divergenciasDoItem(item({ ncm: "22029900" }), produto());
    expect(tipos(d)).toContain("NCM_DIFERENTE");
    expect(bloqueia(d)).toBe(false);
  });

  it("não inventa divergência de NCM quando um dos lados está vazio", () => {
    expect(tipos(divergenciasDoItem(item({ ncm: null }), produto()))).not.toContain(
      "NCM_DIFERENTE",
    );
    expect(tipos(divergenciasDoItem(item(), produto({ ncm: null })))).not.toContain(
      "NCM_DIFERENTE",
    );
  });
});
