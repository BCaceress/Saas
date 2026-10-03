import { describe, expect, it } from "vitest";
import {
  custoDaProposta,
  fatorPrazo,
  prazoPagamentoEmDias,
  type CondicoesProposta,
} from "@/lib/compras/custo-efetivo";

// O custo efetivo muda quem ganha a cotação. Um parser de prazo que lê "28/35/42"
// como 28 ou um rateio de frete que ignora o valor da linha fazem o comparativo
// recomendar a compra errada com um número que parece preciso.

describe("prazoPagamentoEmDias", () => {
  it("entende número solto e com sufixo", () => {
    expect(prazoPagamentoEmDias("28")).toBe(28);
    expect(prazoPagamentoEmDias("28 dias")).toBe(28);
    expect(prazoPagamentoEmDias("28d")).toBe(28);
    expect(prazoPagamentoEmDias("  7 dia ")).toBe(7);
  });

  it("parcelas viram média", () => {
    expect(prazoPagamentoEmDias("28/35/42")).toBe(35);
    expect(prazoPagamentoEmDias("28, 35 e 42 dias")).toBe(35);
    expect(prazoPagamentoEmDias("30 e 60")).toBe(45);
  });

  it("à vista é zero, com ou sem acento", () => {
    expect(prazoPagamentoEmDias("à vista")).toBe(0);
    expect(prazoPagamentoEmDias("A VISTA")).toBe(0);
    expect(prazoPagamentoEmDias("pix antecipado")).toBe(0);
  });

  it("entrada conta como dia zero", () => {
    expect(prazoPagamentoEmDias("entrada + 30")).toBe(15);
  });

  it("sem número e sem à vista é desconhecido", () => {
    expect(prazoPagamentoEmDias("boleto")).toBeNull();
    expect(prazoPagamentoEmDias("")).toBeNull();
    expect(prazoPagamentoEmDias(null)).toBeNull();
  });

  it("descarta número que não pode ser prazo", () => {
    expect(prazoPagamentoEmDias("1500")).toBeNull();
  });
});

describe("fatorPrazo", () => {
  it("à vista ou taxa zero não desconta", () => {
    expect(fatorPrazo(0, 2)).toBe(1);
    expect(fatorPrazo(null, 2)).toBe(1);
    expect(fatorPrazo(30, 0)).toBe(1);
  });

  it("30 dias a 2% a.m. desconta 2%", () => {
    expect(fatorPrazo(30, 2)).toBeCloseTo(1 / 1.02, 10);
  });
});

const base: CondicoesProposta = {
  prazoPagamentoDias: 0,
  frete: null,
};

describe("custoDaProposta", () => {
  it("sem frete nem prazo, custo = preço", () => {
    const r = custoDaProposta([{ itemId: "a", quantidade: 10, preco: 40 }], base, 2);
    expect(r.linhas.get("a")!.unitario).toBe(40);
    expect(r.avisos).toEqual([]);
  });

  it("frete é rateado pelo valor da linha, não pela quantidade", () => {
    // Linha A vale 900, linha B vale 100 → A carrega 90% do frete de 100.
    const r = custoDaProposta(
      [
        { itemId: "a", quantidade: 3, preco: 300 },
        { itemId: "b", quantidade: 10, preco: 10 },
      ],
      { ...base, frete: 100 },
      0,
    );
    expect(r.linhas.get("a")!.freteUnit).toBeCloseTo(30, 10); // 90 ÷ 3
    expect(r.linhas.get("b")!.freteUnit).toBeCloseTo(1, 10); // 10 ÷ 10
  });

  it("prazo traz o custo a valor de hoje", () => {
    const r = custoDaProposta(
      [{ itemId: "a", quantidade: 1, preco: 102 }],
      { ...base, prazoPagamentoDias: 30 },
      2,
    );
    expect(r.linhas.get("a")!.unitario).toBeCloseTo(100, 10);
    expect(r.linhas.get("a")!.descontoPrazoUnit).toBeCloseTo(2, 10);
  });

  it("prazo pode inverter o vencedor", () => {
    // A: R$ 40 à vista. B: R$ 40,50 em 60 dias a 2% a.m. → B sai ~38,93.
    const a = custoDaProposta([{ itemId: "x", quantidade: 1, preco: 40 }], base, 2);
    const b = custoDaProposta(
      [{ itemId: "x", quantidade: 1, preco: 40.5 }],
      { ...base, prazoPagamentoDias: 60 },
      2,
    );
    expect(b.linhas.get("x")!.unitario).toBeLessThan(a.linhas.get("x")!.unitario);
  });

  it("avisa prazo desconhecido e conta como à vista", () => {
    const r = custoDaProposta(
      [{ itemId: "a", quantidade: 1, preco: 10 }],
      { prazoPagamentoDias: null, frete: null },
      2,
    );
    expect(r.avisos).toEqual(["prazo-desconhecido"]);
    expect(r.linhas.get("a")!.unitario).toBe(10);
  });
});
