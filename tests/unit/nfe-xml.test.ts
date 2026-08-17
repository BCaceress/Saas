import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseNotaXml } from "@/lib/fiscal/nfe-xml";
import { fatorDaNota } from "@/lib/fiscal/fator";

/**
 * A fixture é a NF-e 183095/39 da CRBS (Ambev) — o caso difícil de verdade:
 * vende em caixa, tributa em unidade, cobra ICMS-ST e FECOP, e manda
 * "SEM GTIN" em tudo. Os valores foram transcritos da DANFE e fecham no
 * centavo com os quatro totais impressos (ver scripts/fixture-nfe.mjs).
 *
 * Um item lido errado aqui não dá erro em lugar nenhum: vira saldo errado e
 * custo médio errado, calados, semanas depois.
 */
const nota = parseNotaXml(
  readFileSync(resolve(__dirname, "../fixtures/nfe-183095-crbs.xml"), "utf8"),
);

const porCodigo = (cProd: string) => {
  const item = nota.itens.find((i) => i.codigoFornecedor === cProd);
  if (!item) throw new Error(`Item ${cProd} não está na fixture.`);
  return item;
};

describe("parseNotaXml — nota de distribuidor de bebida", () => {
  it("lê cabeçalho, emitente e destinatário", () => {
    expect(nota.chave).toBe("43260856228356007900550390001830951157156333");
    expect(nota.modelo).toBe("55");
    expect(nota.numero).toBe(183095);
    expect(nota.serie).toBe(39);
    expect(nota.valorTotal).toBe(3344.27);
    expect(nota.emitente.cnpj).toBe("56228356007900");
    expect(nota.destinatarioCnpj).toBe("11222333000181");
    expect(nota.itens).toHaveLength(32);
  });

  it("guarda a unidade de venda e a tributável separadas", () => {
    const corona = porCodigo("18836");
    expect(corona.unidade).toBe("CX");
    expect(corona.quantidade).toBe(5);
    expect(corona.unidadeTributavel).toBe("UN");
    expect(corona.quantidadeTributavel).toBe(120);
    // 5 caixas viram 120 garrafas no estoque, não 5.
    expect(fatorDaNota(corona)).toBe(24);
  });

  it("soma FCP-ST no item que o cobra e deixa zero no resto", () => {
    expect(porCodigo("18836").valorFcpSt).toBe(18.98); // Corona
    expect(porCodigo("25837").valorFcpSt).toBe(3.06); // Spaten
    expect(porCodigo("22326").valorFcpSt).toBe(1.38); // Brahma
    expect(porCodigo("27866").valorFcpSt).toBe(3.76); // Corona Cero
    expect(porCodigo("5029").valorFcpSt).toBe(0); // Pepsi, sem FECOP
    const totalFcp = nota.itens.reduce((s, i) => s + i.valorFcpSt, 0);
    expect(totalFcp).toBeCloseTo(27.18, 2);
  });

  it("bate com os totais impressos na DANFE", () => {
    const soma = (f: (i: (typeof nota.itens)[number]) => number) =>
      Math.round(nota.itens.reduce((s, i) => s + f(i), 0) * 100) / 100;
    expect(soma((i) => i.valorTotal)).toBe(2961.57);
    expect(soma((i) => i.valorIpi)).toBe(50.84);
    expect(soma((i) => i.valorIcmsSt)).toBe(251.68);
  });

  it("trata 'SEM GTIN' como ausência de código", () => {
    expect(nota.itens.every((i) => i.gtin === null)).toBe(true);
  });

  it("não confunde venda com bonificação", () => {
    expect(nota.itens.some((i) => i.bonificacao)).toBe(false);
    expect(new Set(nota.itens.map((i) => i.cfop))).toEqual(new Set(["5102", "5403"]));
  });

  it("não inventa fator onde a nota vende e tributa igual", () => {
    // TRIDENT: uCom "cx02", uTrib "cx", 2 e 2.
    const trident = porCodigo("21968");
    expect(trident.quantidade).toBe(2);
    expect(trident.quantidadeTributavel).toBe(2);
    expect(fatorDaNota(trident)).toBeNull();
  });

  it("deixa despesa que só existe no total fora do item", () => {
    // A nota tem R$ 53,00 de outras despesas no rodapé e nada por item — o
    // rateio ainda não existe, e o teste registra isso em vez de fingir.
    expect(nota.itens.every((i) => i.valorFrete === 0)).toBe(true);
  });
});
