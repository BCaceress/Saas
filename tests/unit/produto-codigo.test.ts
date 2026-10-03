import { describe, it, expect } from "vitest";
import {
  alternativasPorCodigo,
  alternativasComEmbalagem,
  alternativasPorTrechoDeCodigo,
  codigosParaExibir,
} from "@/lib/produto-codigo";
import { casaPorCodigo } from "@/lib/fiscal/vinculo";

// ============================================================
// "Onde procurar um código de barras" é a regra que, quando erra, deixa um
// bipe sem resposta com fila no caixa. Vale teste.
// ============================================================

describe("alternativasPorCodigo", () => {
  it("procura no espelho e nos apelidos, nunca só num deles", () => {
    const alt = alternativasPorCodigo("7891000315507");
    expect(alt).toEqual([
      { ean: { in: ["7891000315507"] } },
      { barcodes: { some: { codigo: { in: ["7891000315507"] } } } },
    ]);
  });

  it("código vazio devolve lista vazia — OR vazio no Prisma casaria tudo", () => {
    expect(alternativasPorCodigo("")).toEqual([]);
    expect(alternativasPorCodigo("   ")).toEqual([]);
    expect(alternativasComEmbalagem("")).toEqual([]);
    expect(alternativasPorTrechoDeCodigo("abc")).toEqual([]);
  });

  it("código com sujeira do leitor casa pelos dígitos E pelo texto cru", () => {
    const alt = alternativasPorCodigo(" 789 1000 315507 ");
    expect(alt[0]).toEqual({
      ean: { in: ["7891000315507", "789 1000 315507"] },
    });
  });

  it("embalagem só entra quando pedida — fator do fardo muda o saldo", () => {
    expect(alternativasPorCodigo("17891000315504")).toHaveLength(2);
    expect(alternativasComEmbalagem("17891000315504")).toHaveLength(3);
  });

  it("busca por trecho usa contains, não igualdade", () => {
    const alt = alternativasPorTrechoDeCodigo("7891");
    expect(alt).toEqual([
      { ean: { contains: "7891" } },
      { barcodes: { some: { codigo: { contains: "7891" } } } },
      { packagings: { some: { ean: { contains: "7891" } } } },
    ]);
  });
});

describe("codigosParaExibir", () => {
  it("principal primeiro, qualquer que seja a ordem que veio do banco", () => {
    const lista = codigosParaExibir({
      ean: "111",
      barcodes: [
        { codigo: "222", rotulo: "Caravelas", principal: false },
        { codigo: "111", rotulo: "União", principal: true },
      ],
    });
    expect(lista.map((c) => c.codigo)).toEqual(["111", "222"]);
  });

  it("legado sem linha na tabela continua mostrando o código que tem", () => {
    // Produto cujo EAN o backfill recusou (dois produtos com o mesmo código).
    expect(codigosParaExibir({ ean: "999", barcodes: [] })).toEqual([
      { codigo: "999", rotulo: null, principal: true },
    ]);
  });

  it("não duplica o espelho quando ele já está na tabela", () => {
    const lista = codigosParaExibir({
      ean: "111",
      barcodes: [{ codigo: "111", rotulo: null, principal: true }],
    });
    expect(lista).toHaveLength(1);
  });

  it("produto sem código nenhum devolve lista vazia", () => {
    expect(codigosParaExibir({ ean: null, barcodes: [] })).toEqual([]);
  });
});

describe("casaPorCodigo", () => {
  const produto = {
    ean: "7891000315507",
    codigos: [{ codigo: "7896005800012" }],
    packagings: [{ id: "pk1", ean: "17891000315504", fatorConversao: 12 }],
  };

  it("apelido conta como código do produto — é a nota da outra marca", () => {
    expect(casaPorCodigo(produto, "7896005800012")).toBe(true);
  });

  it("espelho e DUN do fardo seguem casando", () => {
    expect(casaPorCodigo(produto, "7891000315507")).toBe(true);
    expect(casaPorCodigo(produto, "17891000315504")).toBe(true);
  });

  it("código de fora não casa, e null nunca casa", () => {
    expect(casaPorCodigo(produto, "0000000000000")).toBe(false);
    expect(casaPorCodigo(produto, null)).toBe(false);
  });

  it("chamador que só tem o espelho não quebra", () => {
    expect(casaPorCodigo({ ean: "111", packagings: [] }, "111")).toBe(true);
    expect(casaPorCodigo({ ean: "111", packagings: [] }, "222")).toBe(false);
  });
});
