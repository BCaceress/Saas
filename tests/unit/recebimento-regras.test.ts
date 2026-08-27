import { describe, expect, it } from "vitest";
import {
  divergenciasDaConferencia,
  esperadoDaLinha,
  statusDoPedidoPeloSaldo,
  type LinhaConferida,
} from "@/lib/compras/recebimento-regras";

// As duas perguntas que decidem se o estoque se move:
//   "o que ainda não foi explicado?" e "este pedido já chegou por inteiro?".

const linha = (over: Partial<LinhaConferida> = {}): LinhaConferida => ({
  id: "l1",
  descricao: "Cerveja lata 350ml",
  qtdPedida: 100,
  qtdFaturada: 100,
  qtdRecebida: null,
  resolucao: null,
  motivoDivergencia: null,
  ...over,
});

describe("esperadoDaLinha", () => {
  it("usa a nota quando ela existe — é ela que o fornecedor vai cobrar", () => {
    expect(esperadoDaLinha({ qtdPedida: 100, qtdFaturada: 60 })).toBe(60);
  });

  it("cai no pedido quando não houve nota (recebimento sem XML)", () => {
    expect(esperadoDaLinha({ qtdPedida: 100, qtdFaturada: 0 })).toBe(100);
  });
});

describe("divergenciasDaConferencia", () => {
  it("linha não contada entra pelo esperado — não é divergência", () => {
    expect(divergenciasDaConferencia([linha({ qtdRecebida: null })])).toHaveLength(0);
  });

  it("contagem igual ao esperado não é divergência", () => {
    expect(divergenciasDaConferencia([linha({ qtdRecebida: 100 })])).toHaveLength(0);
  });

  it("chegou menos do que se esperava", () => {
    const [d] = divergenciasDaConferencia([linha({ qtdRecebida: 60 })]);
    expect(d).toMatchObject({ itemId: "l1", esperado: 100, recebido: 60 });
  });

  it("chegou mais do que se esperava", () => {
    const [d] = divergenciasDaConferencia([linha({ qtdRecebida: 106 })]);
    expect(d.recebido - d.esperado).toBe(6);
  });

  it("AJUSTADO sozinho NÃO explica — só registra que alguém digitou outro número", () => {
    expect(divergenciasDaConferencia([linha({ qtdRecebida: 60, resolucao: "AJUSTADO" })])).toHaveLength(1);
  });

  it("uma frase no item encerra a pendência", () => {
    const linhas = [linha({ qtdRecebida: 60, motivoDivergencia: "Veio meia carga." })];
    expect(divergenciasDaConferencia(linhas)).toHaveLength(0);
  });

  it("divergência aceita ou ignorada já foi decidida — não volta a perguntar", () => {
    expect(divergenciasDaConferencia([linha({ qtdRecebida: 60, resolucao: "ACEITO" })])).toHaveLength(0);
    expect(divergenciasDaConferencia([linha({ qtdRecebida: 60, resolucao: "IGNORADO" })])).toHaveLength(0);
  });

  it("diferença de arredondamento não vira pendência", () => {
    expect(divergenciasDaConferencia([linha({ qtdRecebida: 100.0005 })])).toHaveLength(0);
  });

  it("sem nota, o esperado é o pedido", () => {
    const linhas = [linha({ qtdFaturada: 0, qtdPedida: 40, qtdRecebida: 30 })];
    expect(divergenciasDaConferencia(linhas)[0]).toMatchObject({ esperado: 40, recebido: 30 });
  });
});

describe("statusDoPedidoPeloSaldo", () => {
  const itens = (pares: [number, number][]) =>
    pares.map(([qtdPedida, qtdRecebida]) => ({ qtdPedida, qtdRecebida }));

  it("nada recebido mantém o pedido como estava — a doca não mexe no pedido", () => {
    expect(statusDoPedidoPeloSaldo(itens([[100, 0]]), "AGUARDANDO")).toBe("AGUARDANDO");
    expect(statusDoPedidoPeloSaldo(itens([[100, 0]]), "EM_TRANSITO")).toBe("EM_TRANSITO");
  });

  it("chegou parte: parcialmente recebido", () => {
    expect(statusDoPedidoPeloSaldo(itens([[100, 60]]), "AGUARDANDO")).toBe("RECEBIDO_PARCIAL");
  });

  it("um item completo e outro não ainda é parcial", () => {
    expect(
      statusDoPedidoPeloSaldo(itens([[100, 100], [50, 0]]), "AGUARDANDO"),
    ).toBe("RECEBIDO_PARCIAL");
  });

  it("tudo recebido fecha o pedido", () => {
    expect(statusDoPedidoPeloSaldo(itens([[100, 100], [50, 50]]), "RECEBIDO_PARCIAL")).toBe(
      "RECEBIDO",
    );
  });

  it("recebeu a mais também fecha — o pedido não fica aberto por sobra", () => {
    expect(statusDoPedidoPeloSaldo(itens([[100, 106]]), "AGUARDANDO")).toBe("RECEBIDO");
  });

  it("cancelado e rascunho não se movem por saldo", () => {
    expect(statusDoPedidoPeloSaldo(itens([[100, 100]]), "CANCELADO")).toBe("CANCELADO");
    expect(statusDoPedidoPeloSaldo(itens([[100, 100]]), "RASCUNHO")).toBe("RASCUNHO");
  });

  it("pedido sem itens não vira 'recebido' por vacuidade", () => {
    expect(statusDoPedidoPeloSaldo([], "AGUARDANDO")).toBe("AGUARDANDO");
  });
});
