import { describe, it, expect } from "vitest";
import { cfopDeEntrada } from "@/lib/fiscal/cfop";

/**
 * O CFOP do XML é da SAÍDA do fornecedor. Se este mapa devolver o número como
 * veio, o perfil fiscal do produto nasce com o CFOP de quem vendeu — e a
 * primeira NF-e emitida sai classificada como venda alheia.
 */
describe("cfopDeEntrada", () => {
  it("espelha a saída do fornecedor na entrada equivalente", () => {
    // Venda dentro do estado → compra dentro do estado.
    expect(cfopDeEntrada("5102")).toBe("1102");
    // Venda interestadual → compra interestadual.
    expect(cfopDeEntrada("6102")).toBe("2102");
    // Substituição tributária, o caso de bebida. A troca é do dígito de
    // origem/destino, não uma tabela de equivalência semântica — o perfil
    // nasce `precisaRevisao` justamente porque quem fecha isso é o contador.
    expect(cfopDeEntrada("5405")).toBe("1405");
    expect(cfopDeEntrada("6404")).toBe("2404");
    // Bonificação / brinde.
    expect(cfopDeEntrada("5910")).toBe("1910");
    // Importação.
    expect(cfopDeEntrada("7102")).toBe("3102");
  });

  it("não inventa CFOP quando o número não é de saída", () => {
    // Já é entrada — não existe "entrada da entrada".
    expect(cfopDeEntrada("1102")).toBeNull();
    expect(cfopDeEntrada("")).toBeNull();
    expect(cfopDeEntrada(null)).toBeNull();
    expect(cfopDeEntrada(undefined)).toBeNull();
    expect(cfopDeEntrada("510")).toBeNull();
    expect(cfopDeEntrada("51022")).toBeNull();
  });

  it("aceita o CFOP formatado com ponto, como algumas notas trazem", () => {
    expect(cfopDeEntrada("5.102")).toBe("1102");
  });
});
