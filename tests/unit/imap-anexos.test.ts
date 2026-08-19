import { describe, expect, it } from "vitest";
import { aceitaAnexo, anexosCandidatos, type NoCorpo } from "@/lib/fiscal/imap";

// A caixa de compras é um lixão: assinatura em PNG, boleto em PDF, catálogo de
// 40 MB e, no meio, o XML da nota. Escolher errado aqui custa caro dos dois
// lados — baixar 40 MB à toa ou deixar a nota passar batido.

describe("anexosCandidatos", () => {
  it("acha o anexo dentro de multipart aninhado", () => {
    const estrutura: NoCorpo = {
      type: "multipart/mixed",
      childNodes: [
        {
          type: "multipart/alternative",
          childNodes: [
            { part: "1.1", type: "text/plain", size: 300 },
            { part: "1.2", type: "text/html", size: 900 },
          ],
        },
        {
          part: "2",
          type: "application/xml",
          disposition: "attachment",
          dispositionParameters: { filename: "NFe3526.xml" },
          size: 12_000,
        },
      ],
    };

    expect(anexosCandidatos(estrutura)).toEqual([
      { part: "2", nome: "NFe3526.xml", size: 12_000 },
    ]);
  });

  it("aceita nome vindo de parameters.name quando não há disposition", () => {
    const estrutura: NoCorpo = {
      type: "multipart/mixed",
      childNodes: [
        {
          part: "1",
          type: "text/xml",
          parameters: { name: "nota.xml" },
          size: 5_000,
        },
      ],
    };

    expect(anexosCandidatos(estrutura)).toEqual([{ part: "1", nome: "nota.xml", size: 5_000 }]);
  });

  it("ignora corpo de texto sem nome e estrutura vazia", () => {
    expect(anexosCandidatos(undefined)).toEqual([]);
    expect(anexosCandidatos({ part: "1", type: "text/plain", size: 200 })).toEqual([]);
  });
});

describe("aceitaAnexo", () => {
  it("aceita xml e zip, em qualquer caixa", () => {
    expect(aceitaAnexo("NFe123.XML", 1_000)).toBe(true);
    expect(aceitaAnexo(" notas-agosto.zip ", 900_000)).toBe(true);
  });

  it("recusa PDF do DANFE e imagem de assinatura", () => {
    expect(aceitaAnexo("danfe.pdf", 200_000)).toBe(false);
    expect(aceitaAnexo("logo.png", 20_000)).toBe(false);
  });

  it("recusa arquivo grande demais para ser nota", () => {
    expect(aceitaAnexo("catalogo.zip", 40 * 1024 * 1024)).toBe(false);
  });
});
