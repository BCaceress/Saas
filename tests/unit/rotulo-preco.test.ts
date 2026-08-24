import { describe, it, expect } from "vitest";
import { rotuloPreco, rotuloPrecoCurto } from "@/lib/compras/rotulo-preco";

/**
 * O rótulo do campo de preço é a única defesa contra o erro mais caro da
 * cotação: o vendedor lê "Preço unitário" numa linha de fardo, digita o preço
 * da garrafa, e o comparativo elege um vencedor doze vezes mais barato que a
 * realidade. O texto tem de dizer a embalagem que está na linha.
 */
describe("rotuloPreco", () => {
  it("embalagem de compra leva o artigo e o fator", () => {
    expect(rotuloPreco({ nome: "Caixa", fator: 12, label: "Caixa (12 un.)" })).toBe(
      "Preço da caixa (12 un.)",
    );
    expect(rotuloPreco({ nome: "Fardo", fator: 6, label: "Fardo (6 un.)" })).toBe(
      "Preço do fardo (6 un.)",
    );
    expect(rotuloPreco({ nome: "Engradado", fator: 24, label: "Engradado (24 un.)" })).toBe(
      "Preço do engradado (24 un.)",
    );
  });

  it("gênero fora da regra do -a vem da lista de exceções", () => {
    expect(rotuloPreco({ nome: "Grade", fator: 20, label: "Grade (20 un.)" })).toBe(
      "Preço da grade (20 un.)",
    );
    expect(rotuloPreco({ nome: "Display", fator: 6, label: "Display (6 un.)" })).toBe(
      "Preço do display (6 un.)",
    );
  });

  it("unidade avulsa continua sendo preço unitário", () => {
    expect(rotuloPreco({ nome: "Unidade", fator: 1, label: "un" })).toBe("Preço unitário");
    expect(rotuloPreco({ nome: "un", fator: 1, label: "un" })).toBe("Preço unitário");
    expect(rotuloPreco(null)).toBe("Preço unitário");
  });

  it("peso e volume são 'por', não 'do'", () => {
    expect(rotuloPreco({ nome: "kg", fator: 1, label: "kg" })).toBe("Preço por kg");
    expect(rotuloPreco({ nome: "ml", fator: 1, label: "ml" })).toBe("Preço por ml");
  });

  it("a versão curta tira o fator, para caber em cabeçalho de coluna", () => {
    expect(rotuloPrecoCurto({ nome: "Caixa", fator: 12, label: "Caixa (12 un.)" })).toBe(
      "Preço da caixa",
    );
    expect(rotuloPrecoCurto(null)).toBe("Preço unitário");
  });
});
