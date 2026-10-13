import { describe, it, expect } from "vitest";
import {
  CONFIANCA,
  casarComPedido,
  ehProva,
  mesclarSugestoes,
  semelhanca,
} from "@/lib/compras/sugestao-pelo-pedido-regras";

/**
 * O pedido reduz o universo: em vez de procurar "CERV HNK LN" em mil produtos,
 * a pergunta é qual dos vinte do pedido é este. O que se prova aqui é que o
 * palpite só aparece quando há folga — palpite errado aceito no embalo vira
 * de-para gravado, e o erro se repete em toda nota seguinte do fornecedor.
 */
const pedido = [
  { id: "heineken", nome: "Cerveja Heineken Long Neck 330ml", codigos: ["7896045506873", "17896045506870"] },
  { id: "coca", nome: "Coca-Cola 2L", codigos: ["7894900011517"] },
  { id: "guarana", nome: "Guaraná Antarctica 2L", codigos: [] },
];

describe("semelhanca", () => {
  it("abreviação do fornecedor encontra a palavra do cadastro", () => {
    expect(semelhanca("CERV HEINEKEN LONG NECK 330ML CX24", "Cerveja Heineken Long Neck 330ml")).toBe(1);
  });

  it("lixo da descrição da nota não derruba a nota do produto", () => {
    expect(semelhanca("REFRIG COCA COLA 2L PET FD6", "Coca-Cola 2L")).toBe(1);
  });

  it("produto sem relação fica perto de zero", () => {
    expect(semelhanca("AGUA MINERAL 500ML", "Guaraná Antarctica 2L")).toBe(0);
  });
});

describe("casarComPedido", () => {
  it("código de barras da caixa casa com o produto, e é prova", () => {
    const pares = casarComPedido(
      [{ id: "i1", descricao: "QUALQUER COISA", gtin: "17896045506870" }],
      pedido,
    );
    expect(pares).toEqual([{ itemId: "i1", productId: "heineken", motivo: "EAN" }]);
  });

  it("sem código, casa pelo nome quando há folga", () => {
    const pares = casarComPedido(
      [{ id: "i1", descricao: "REFRIG COCA COLA 2L PET FD6", gtin: null }],
      pedido,
    );
    expect(pares).toEqual([{ itemId: "i1", productId: "coca", motivo: "NOME" }]);
  });

  it("empate entre dois produtos do pedido não vira palpite", () => {
    const pares = casarComPedido(
      [{ id: "i1", descricao: "REFRIGERANTE 2L", gtin: null }],
      [
        { id: "a", nome: "Refrigerante 2L Cola", codigos: [] },
        { id: "b", nome: "Refrigerante 2L Laranja", codigos: [] },
      ],
    );
    expect(pares).toEqual([]);
  });

  it("um produto do pedido responde por uma linha só", () => {
    const pares = casarComPedido(
      [
        { id: "i1", descricao: "COCA COLA 2L", gtin: null },
        { id: "i2", descricao: "COCA COLA 2L BONIF", gtin: null },
      ],
      [{ id: "coca", nome: "Coca-Cola 2L", codigos: [] }],
    );
    expect(pares).toHaveLength(1);
    expect(pares[0].productId).toBe("coca");
  });

  it("produto já ocupado por outra linha da nota fica fora", () => {
    const pares = casarComPedido(
      [{ id: "i1", descricao: "COCA COLA 2L", gtin: "7894900011517" }],
      pedido,
      ["coca"],
    );
    expect(pares).toEqual([]);
  });
});

/**
 * As camadas do motor. O que se protege aqui é a regra que não pode quebrar:
 * nome parecido NUNCA vira prova — nem sozinho, nem por ter vindo do pedido.
 */
describe("camadas de correspondência", () => {
  it("só código de barras é prova", () => {
    expect(ehProva("EAN")).toBe(true);
    expect(ehProva("PEDIDO")).toBe(false);
    expect(ehProva("NOME")).toBe(false);
  });

  it("cada camada tem nível e justificativa próprios", () => {
    expect(CONFIANCA.EAN.nivel).toBe("alta");
    expect(CONFIANCA.PEDIDO.nivel).toBe("media");
    expect(CONFIANCA.NOME.nivel).toBe("baixa");
    for (const c of Object.values(CONFIANCA)) expect(c.justificativa.length).toBeGreaterThan(10);
  });

  it("EAN do catálogo vence o palpite por nome do pedido", () => {
    const r = mesclarSugestoes(
      [{ itemId: "i1", motivo: "PEDIDO" as const, productId: "semelhante" }],
      [{ itemId: "i1", motivo: "EAN" as const, productId: "certo" }],
    );
    expect(r).toEqual([{ itemId: "i1", motivo: "EAN", productId: "certo" }]);
  });

  it("palpite do pedido vence o palpite por nome do catálogo inteiro", () => {
    const r = mesclarSugestoes(
      [{ itemId: "i1", motivo: "PEDIDO" as const, productId: "doPedido" }],
      [{ itemId: "i1", motivo: "NOME" as const, productId: "doCatalogo" }],
    );
    expect(r[0].productId).toBe("doPedido");
  });

  it("um palpite por item, e item sem palpite não aparece", () => {
    const r = mesclarSugestoes(
      [{ itemId: "i1", motivo: "PEDIDO" as const }],
      [
        { itemId: "i1", motivo: "NOME" as const },
        { itemId: "i2", motivo: "NOME" as const },
      ],
    );
    expect(r.map((s) => s.itemId).sort()).toEqual(["i1", "i2"]);
  });
});
