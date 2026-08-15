import { describe, it, expect } from "vitest";
import { fatorDaNota } from "@/lib/fiscal/fator";

/**
 * Os casos abaixo saem de uma NF-e real de distribuidor de bebida (CRBS/Ambev,
 * série 39 nº 183095): é exatamente o formato em que a caixa vira garrafa. Se
 * esta regra devolver 1 onde deveria devolver 24, a entrada põe 5 unidades no
 * lugar de 120 e o custo médio do produto vira ficção.
 */
describe("fatorDaNota", () => {
  it("tira o fator de qTrib/qCom quando o fornecedor vende em caixa", () => {
    // CORONA EXTRA LONG NECK 330ML CX C/24: 5 cx = 120 un.
    expect(
      fatorDaNota({ quantidade: 5, unidadeTributavel: "UN", quantidadeTributavel: 120 }),
    ).toBe(24);
    // PEPSI COLA 3L C/04: 10 cx = 40 un.
    expect(
      fatorDaNota({ quantidade: 10, unidadeTributavel: "UN", quantidadeTributavel: 40 }),
    ).toBe(4);
    // RED BULL 473ML CX C/12: 1 cx = 12 un.
    expect(
      fatorDaNota({ quantidade: 1, unidadeTributavel: "UN", quantidadeTributavel: 12 }),
    ).toBe(12);
  });

  it("devolve null quando a nota tributa na mesma unidade em que vende", () => {
    // TRIDENT: uCom "cx02" e uTrib "cx", 2 e 2 — não há conversão a fazer.
    expect(
      fatorDaNota({ quantidade: 2, unidadeTributavel: "CX", quantidadeTributavel: 2 }),
    ).toBeNull();
    expect(
      fatorDaNota({ quantidade: 1, unidadeTributavel: "CX", quantidadeTributavel: 1 }),
    ).toBeNull();
  });

  it("ignora unidade de peso ou volume", () => {
    // 1 caixa que pesa 8,4 kg não são 8 unidades.
    expect(
      fatorDaNota({ quantidade: 1, unidadeTributavel: "KG", quantidadeTributavel: 8.4 }),
    ).toBeNull();
    expect(
      fatorDaNota({ quantidade: 2, unidadeTributavel: "l", quantidadeTributavel: 12 }),
    ).toBeNull();
  });

  it("recusa razão fracionada — sinal de que os campos não conversam", () => {
    expect(
      fatorDaNota({ quantidade: 3, unidadeTributavel: "UN", quantidadeTributavel: 10 }),
    ).toBeNull();
  });

  it("aguenta nota sem qTrib e quantidade zerada", () => {
    expect(
      fatorDaNota({ quantidade: 5, unidadeTributavel: null, quantidadeTributavel: null }),
    ).toBeNull();
    expect(
      fatorDaNota({ quantidade: 0, unidadeTributavel: "UN", quantidadeTributavel: 120 }),
    ).toBeNull();
  });

  it("não se perde no arredondamento de ponto flutuante", () => {
    // 0,3 cx × 10 un/cx: a divisão dá 9,999999999999998 em float.
    expect(
      fatorDaNota({ quantidade: 0.3, unidadeTributavel: "UN", quantidadeTributavel: 3 }),
    ).toBe(10);
  });
});
