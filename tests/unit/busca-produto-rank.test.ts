import { describe, it, expect } from "vitest";
import {
  ordenarPorRelevancia,
  pontuarProduto,
  tokensDaBusca,
} from "@/lib/compras/busca-produto-rank";

/**
 * A ordem desta lista é o que decide se o operador relaciona o item em um
 * clique ou rola trinta produtos. Alfabético era o problema: quem digita
 * "heineken ln" via "Água Crystal" primeiro — e, com LIMIT no banco, às vezes
 * não via o long neck de jeito nenhum.
 */
const p = (
  nome: string,
  sku = "SKU",
  ean: string | null = null,
  embalagens: { ean: string | null }[] = [],
) => ({ nome, sku, ean, embalagens });

const CATALOGO = [
  p("Água Crystal 500ml", "AGU-001", "7891910000197"),
  p("Cerveja Heineken Long Neck 330ml", "CER-330", "7896045506873", [
    { ean: "17896045506870" },
  ]),
  p("Cerveja Heineken Lata 350ml", "CER-350", "7896045500000"),
  p("Cerveja Heineken Long Neck 330ml kit festa 12un", "CER-K12", null),
  p("Refrigerante Guaraná Antarctica 2L", "REF-2L", "7891991000000"),
];

describe("tokensDaBusca", () => {
  it("parte por espaço e ignora pedaço de uma letra", () => {
    expect(tokensDaBusca("CERV HEINEKEN LN 330ML")).toEqual(["cerv", "heineken", "ln", "330ml"]);
  });

  it("tira acento e pontuação", () => {
    expect(tokensDaBusca("Guaraná Antárctica, 2L")).toEqual(["guarana", "antarctica", "2l"]);
  });
});

describe("ordenarPorRelevancia", () => {
  it("põe no topo quem casa com todas as palavras digitadas", () => {
    const r = ordenarPorRelevancia(CATALOGO, "heineken long neck");
    expect(r[0].nome).toBe("Cerveja Heineken Long Neck 330ml");
  });

  it("nome mais curto desempata entre dois que casam igual", () => {
    const r = ordenarPorRelevancia(CATALOGO, "heineken long neck 330");
    expect(r[0].sku).toBe("CER-330");
    expect(r[1].sku).toBe("CER-K12");
  });

  it("código de barras digitado ganha de qualquer nome", () => {
    const r = ordenarPorRelevancia(CATALOGO, "7891910000197");
    expect(r[0].nome).toBe("Água Crystal 500ml");
  });

  it("código de barras da embalagem também acha o produto", () => {
    const r = ordenarPorRelevancia(CATALOGO, "17896045506870");
    expect(r[0].sku).toBe("CER-330");
  });

  it("GTIN do item da nota desempata quando o texto é vago", () => {
    const r = ordenarPorRelevancia(CATALOGO, "cerveja", "7896045500000");
    expect(r[0].sku).toBe("CER-350");
  });

  it("SKU digitado leva ao produto", () => {
    const r = ordenarPorRelevancia(CATALOGO, "REF-2L");
    expect(r[0].sku).toBe("REF-2L");
  });

  it("nunca devolve alfabético quando há termo", () => {
    const r = ordenarPorRelevancia(CATALOGO, "guarana");
    expect(r[0].nome).toContain("Guaraná");
  });
});

describe("pontuarProduto", () => {
  it("palavra digitada que não aparece derruba a pontuação", () => {
    const lata = p("Cerveja Heineken Lata 350ml", "CER-350");
    expect(pontuarProduto(lata, "heineken lata")).toBeGreaterThan(
      pontuarProduto(lata, "heineken long neck"),
    );
  });

  it("abreviação da nota casa com o começo da palavra", () => {
    // "CERV HEINEKEN LN" — como o fornecedor escreve na NF-e.
    const ln = p("Cerveja Heineken Long Neck 330ml", "CER-330");
    expect(pontuarProduto(ln, "CERV HEINEKEN LN")).toBeGreaterThan(0);
  });
});
