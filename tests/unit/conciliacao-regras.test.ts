import { describe, it, expect } from "vitest";
import {
  custoMudou,
  termoDeBuscaDoItem,
  variacaoCusto,
  vereditoDaLinha,
} from "@/lib/compras/conciliacao-regras";

/**
 * O veredito de cada linha é o que o operador lê na porta com a mercadoria na
 * mão. Errar aqui não é um selo feio: é receber 8 caixas achando que vieram 10,
 * ou pagar 9% a mais sem ninguém perceber.
 *
 * Quantidades e custos são sempre em UNIDADE BASE — o pedido de "10 caixas de
 * 12" chega aqui como 120.
 */
describe("vereditoDaLinha", () => {
  it("bate quantidade e custo → OK", () => {
    expect(
      vereditoDaLinha({ qtdPedida: 240, qtdFaturada: 240, custoPedido: 7.5, custoFaturado: 7.5 }),
    ).toBe("OK");
  });

  it("fornecedor faturou menos → FALTANDO", () => {
    // Pedido 10 cx de 12, vieram 8 cx.
    expect(
      vereditoDaLinha({ qtdPedida: 120, qtdFaturada: 96, custoPedido: 7.5, custoFaturado: 7.5 }),
    ).toBe("FALTANDO");
  });

  it("fornecedor faturou mais → EXCEDENTE", () => {
    expect(
      vereditoDaLinha({ qtdPedida: 120, qtdFaturada: 144, custoPedido: 7.5, custoFaturado: 7.5 }),
    ).toBe("EXCEDENTE");
  });

  it("quantidade certa e preço maior → PRECO_ALTERADO", () => {
    expect(
      vereditoDaLinha({ qtdPedida: 120, qtdFaturada: 120, custoPedido: 7.5, custoFaturado: 8.2 }),
    ).toBe("PRECO_ALTERADO");
  });

  it("quantidade vem antes de preço — faltar mercadoria é outro problema", () => {
    expect(
      vereditoDaLinha({ qtdPedida: 120, qtdFaturada: 96, custoPedido: 7.5, custoFaturado: 8.2 }),
    ).toBe("FALTANDO");
  });

  it("centavo de rateio não vira divergência de preço", () => {
    expect(
      vereditoDaLinha({ qtdPedida: 120, qtdFaturada: 120, custoPedido: 7.5, custoFaturado: 7.503 }),
    ).toBe("OK");
  });

  it("bonificação (sem custo negociado) não acusa preço alterado", () => {
    expect(
      vereditoDaLinha({ qtdPedida: 24, qtdFaturada: 24, custoPedido: 0, custoFaturado: 0 }),
    ).toBe("OK");
  });
});

describe("custoMudou", () => {
  it("ignora variação abaixo de meio por cento", () => {
    expect(custoMudou(10, 10.03)).toBe(false);
  });

  it("acusa alta relevante", () => {
    expect(custoMudou(7.5, 8.2)).toBe(true);
  });

  it("acusa queda relevante — preço menor também é notícia", () => {
    expect(custoMudou(7.5, 6.9)).toBe(true);
  });

  it("sem preço negociado não há comparação", () => {
    expect(custoMudou(0, 8.2)).toBe(false);
  });
});

describe("termoDeBuscaDoItem", () => {
  it("corta a descrição do fornecedor onde começa a embalagem", () => {
    expect(termoDeBuscaDoItem("CERV HEINEKEN LN 330ML CX C/24")).toBe("CERV HEINEKEN LN");
  });

  it("mantém descrição curta inteira", () => {
    expect(termoDeBuscaDoItem("BUDWEISER LATA")).toBe("BUDWEISER LATA");
  });

  it("aguenta espaço duplo e sobra nas pontas", () => {
    expect(termoDeBuscaDoItem("  SKOL   BEATS  GT 269ML ")).toBe("SKOL BEATS GT");
  });

  it("nunca passa de 30 caracteres", () => {
    expect(termoDeBuscaDoItem("REFRIGERANTE GUARANATURAL ANTARCTICA").length).toBeLessThanOrEqual(30);
  });
});

describe("variacaoCusto", () => {
  it("calcula a alta em porcentagem", () => {
    expect(variacaoCusto(7.5, 8.2)).toBeCloseTo(9.33, 2);
  });

  it("devolve null quando não há preço negociado", () => {
    expect(variacaoCusto(0, 8.2)).toBeNull();
  });

  it("devolve null quando o preço é o mesmo", () => {
    expect(variacaoCusto(7.5, 7.5)).toBeNull();
  });
});
