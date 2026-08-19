import { describe, expect, it } from "vitest";
import { ratearTotaisDaNota } from "@/lib/fiscal/rateio";

// O erro que este módulo evita é silencioso: frete lançado só no total da nota
// some do custo do item, o custo médio entra menor do que foi pago e a margem
// da venda mente para cima o mês inteiro.

const linha = (valorTotal: number, extras: Partial<{ valorFrete: number; valorDesconto: number; bonificacao: boolean }> = {}) => ({
  valorTotal,
  valorFrete: extras.valorFrete ?? 0,
  valorDesconto: extras.valorDesconto ?? 0,
  bonificacao: extras.bonificacao ?? false,
});

describe("ratearTotaisDaNota", () => {
  it("rateia proporcionalmente o frete lançado só no cabeçalho", () => {
    const r = ratearTotaisDaNota([linha(300), linha(100)], { frete: 40, desconto: 0 });
    expect(r).toEqual([
      { valorFrete: 30, valorDesconto: 0 },
      { valorFrete: 10, valorDesconto: 0 },
    ]);
  });

  it("não soma de novo quando os itens já trazem o frete", () => {
    const linhas = [linha(300, { valorFrete: 30 }), linha(100, { valorFrete: 10 })];
    expect(ratearTotaisDaNota(linhas, { frete: 40, desconto: 0 })).toEqual([
      { valorFrete: 30, valorDesconto: 0 },
      { valorFrete: 10, valorDesconto: 0 },
    ]);
  });

  it("rateia só a diferença quando o item tem parte do frete", () => {
    const linhas = [linha(500, { valorFrete: 10 }), linha(500, { valorFrete: 10 })];
    const r = ratearTotaisDaNota(linhas, { frete: 40, desconto: 0 });
    expect(r[0].valorFrete + r[1].valorFrete).toBeCloseTo(40, 2);
  });

  it("fecha exatamente com o total, mesmo com dízima", () => {
    const linhas = [linha(100), linha(100), linha(100)];
    const r = ratearTotaisDaNota(linhas, { frete: 10, desconto: 0 });
    const soma = r.reduce((s, l) => s + l.valorFrete, 0);
    expect(Number(soma.toFixed(2))).toBe(10);
  });

  it("não joga custo em bonificação", () => {
    const linhas = [linha(100, { bonificacao: true }), linha(100)];
    expect(ratearTotaisDaNota(linhas, { frete: 20, desconto: 0 })).toEqual([
      { valorFrete: 0, valorDesconto: 0 },
      { valorFrete: 20, valorDesconto: 0 },
    ]);
  });

  it("ignora diferença de centavo (arredondamento do emitente)", () => {
    const linhas = [linha(100, { valorFrete: 4.99 })];
    expect(ratearTotaisDaNota(linhas, { frete: 5, desconto: 0 })).toEqual([
      { valorFrete: 4.99, valorDesconto: 0 },
    ]);
  });

  it("rateia desconto do cabeçalho igual ao frete", () => {
    const r = ratearTotaisDaNota([linha(200), linha(200)], { frete: 0, desconto: 30 });
    expect(r).toEqual([
      { valorFrete: 0, valorDesconto: 15 },
      { valorFrete: 0, valorDesconto: 15 },
    ]);
  });

  it("não quebra quando a nota é só de bonificação", () => {
    const linhas = [linha(0, { bonificacao: true })];
    expect(ratearTotaisDaNota(linhas, { frete: 50, desconto: 0 })).toEqual([
      { valorFrete: 0, valorDesconto: 0 },
    ]);
  });
});
