import { describe, expect, it } from "vitest";
import {
  promptLeitura,
  validarLeitura,
  type ItemParaLeitura,
} from "@/lib/compras/cotacao-leitura";

// A leitura por LLM preenche a proposta que o operador vai salvar. Tudo que o
// modelo inventar e passar por aqui vira preço no comparativo — por isso o
// filtro é testado como se o modelo fosse adversário.

const itens: ItemParaLeitura[] = [
  { descricao: "Skol lata 350ml", quantidade: 10, embalagem: "Caixa (12 un.)", esperado: 40 },
  { descricao: "Brahma lata 350ml", quantidade: 5, embalagem: "Caixa (12 un.)", esperado: null },
  { descricao: "Gelo 5kg", quantidade: 20, embalagem: null, esperado: 8 },
];

describe("validarLeitura", () => {
  it("aceita o caso comum", () => {
    const r = validarLeitura(
      {
        itens: [
          { n: 1, preco: 42.9 },
          { n: 2, naoTem: true },
        ],
        condicaoPagamento: "28/35",
        prazoEntregaDias: 2,
        frete: 0,
      },
      itens,
    );
    expect(r.itens).toEqual([
      { indice: 0, preco: 42.9, naoTem: false, convertido: false, suspeito: false },
      { indice: 1, preco: null, naoTem: true, convertido: false, suspeito: false },
    ]);
    expect(r.condicaoPagamento).toBe("28/35");
    expect(r.prazoEntregaDias).toBe(2);
    expect(r.frete).toBe(0);
  });

  it("descarta índice fora da lista, não inteiro e repetido", () => {
    const r = validarLeitura(
      {
        itens: [
          { n: 0, preco: 10 },
          { n: 4, preco: 10 },
          { n: 1.5, preco: 10 },
          { n: 3, preco: 9 },
          { n: 3, preco: 99 },
        ],
      },
      itens,
    );
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0]).toMatchObject({ indice: 2, preco: 9 });
  });

  it("descarta preço absurdo e linha sem conteúdo", () => {
    const r = validarLeitura(
      {
        itens: [
          { n: 1, preco: -5 },
          { n: 2, preco: "abc" },
          { n: 3, preco: 1e9 },
        ],
      },
      itens,
    );
    expect(r.itens).toEqual([]);
  });

  it("aceita preço em texto com vírgula", () => {
    const r = validarLeitura({ itens: [{ n: 1, preco: "1.042,50" }] }, itens);
    expect(r.itens[0].preco).toBe(1042.5);
    // Ponto decimal sem vírgula NÃO é milhar.
    const s = validarLeitura({ itens: [{ n: 1, preco: "42.9" }] }, itens);
    expect(s.itens[0].preco).toBe(42.9);
  });

  it("marca preço longe do custo conhecido", () => {
    // Esperado 40 por caixa; 3,50 é preço de lata — unidade trocada.
    const r = validarLeitura({ itens: [{ n: 1, preco: 3.5 }, { n: 2, preco: 3.5 }] }, itens);
    expect(r.itens[0].suspeito).toBe(true);
    // Sem referência não há como suspeitar.
    expect(r.itens[1].suspeito).toBe(false);
  });

  it("naoTem ganha do preço", () => {
    const r = validarLeitura({ itens: [{ n: 1, preco: 40, naoTem: true }] }, itens);
    expect(r.itens[0]).toMatchObject({ preco: null, naoTem: true });
  });

  it("aguenta lixo no formato", () => {
    const r = validarLeitura(
      { itens: "nada" as never, naoIdentificados: [1, "Heineken 58,00", ""], prazoEntregaDias: 3.5 },
      itens,
    );
    expect(r.itens).toEqual([]);
    expect(r.naoIdentificados).toEqual(["Heineken 58,00"]);
    expect(r.prazoEntregaDias).toBeNull();
  });
});

describe("promptLeitura", () => {
  it("numera a lista a partir de 1 e cerca a mensagem", () => {
    const p = promptLeitura(itens, "skol 42,90");
    expect(p).toContain("1. Skol lata 350ml — 10 × Caixa (12 un.)");
    expect(p).toContain("3. Gelo 5kg — 20 × unidade");
    expect(p).toContain("<<<\nskol 42,90\n>>>");
  });

  it("sem mensagem, aponta para o anexo", () => {
    expect(promptLeitura(itens, null)).toContain("arquivo anexo");
  });
});
