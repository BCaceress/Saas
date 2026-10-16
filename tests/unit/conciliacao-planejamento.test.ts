import { describe, expect, it } from "vitest";
import {
  mesclarContagemAnterior,
  planejarConciliacao,
  type ConferenciaAnterior,
  type ItemDaNotaConciliado,
  type ItemDoPedidoConciliado,
} from "@/lib/compras/conciliacao-regras";

// O pareamento nota × pedido decide o que a doca espera receber. Errar aqui é
// esperar de novo o que já entrou, acusar falta que não existe ou deixar a
// bonificação comer a linha comprada. Tudo em unidade base.

const pedido = (over: Partial<ItemDoPedidoConciliado> & { id: string }): ItemDoPedidoConciliado => ({
  productId: "heineken",
  compra: true,
  saldo: 120,
  custoBase: 5,
  ...over,
});

const nota = (over: Partial<ItemDaNotaConciliado> & { id: string }): ItemDaNotaConciliado => ({
  productId: "heineken",
  bonificacao: false,
  qtdBase: 120,
  custoBase: 5,
  ...over,
});

describe("planejarConciliacao", () => {
  it("nota igual ao pedido: uma linha OK", () => {
    const [l, ...resto] = planejarConciliacao([pedido({ id: "p1" })], [nota({ id: "n1" })]);
    expect(resto).toHaveLength(0);
    expect(l).toMatchObject({
      inboundItemId: "n1",
      purchaseOrderItemId: "p1",
      qtdPedida: 120,
      qtdFaturada: 120,
      status: "OK",
    });
  });

  it("segunda entrega é conferida contra o SALDO, não contra o pedido inteiro", () => {
    // Pedido de 120, 72 já recebidos: a nota de 48 fecha o pedido. Antes, a
    // linha acusava "pedido 120 · faturado 48 — faltam 72".
    const [l] = planejarConciliacao([pedido({ id: "p1", saldo: 48 })], [nota({ id: "n1", qtdBase: 48 })]);
    expect(l).toMatchObject({ qtdPedida: 48, status: "OK" });
  });

  it("item do pedido já recebido por inteiro e fora desta nota não vira linha", () => {
    // Antes ele entrava como linha OK esperando a quantidade pedida inteira —
    // e, sem contagem, entrava de novo no estoque.
    const linhas = planejarConciliacao(
      [pedido({ id: "p1" }), pedido({ id: "p2", productId: "coca", saldo: 0 })],
      [nota({ id: "n1" })],
    );
    expect(linhas.map((l) => l.purchaseOrderItemId)).toEqual(["p1"]);
  });

  it("o que tem saldo e não veio na nota é NAO_FATURADO, pelo saldo", () => {
    const linhas = planejarConciliacao(
      [pedido({ id: "p1" }), pedido({ id: "p2", productId: "coca", saldo: 60, custoBase: 3 })],
      [nota({ id: "n1" })],
    );
    expect(linhas[1]).toMatchObject({
      inboundItemId: null,
      purchaseOrderItemId: "p2",
      qtdPedida: 60,
      qtdFaturada: 0,
      custoPedido: 3,
      status: "NAO_FATURADO",
    });
  });

  it("nota que quebra a linha do pedido em dois lotes: duas linhas OK", () => {
    const linhas = planejarConciliacao(
      [pedido({ id: "p1" })],
      [nota({ id: "n1", qtdBase: 60 }), nota({ id: "n2", qtdBase: 60 })],
    );
    expect(linhas).toHaveLength(2);
    expect(linhas.every((l) => l.purchaseOrderItemId === "p1" && l.status === "OK")).toBe(true);
    expect(linhas.map((l) => l.qtdPedida)).toEqual([60, 60]);
  });

  it("lotes que somam menos que o saldo: a última linha leva a falta", () => {
    const linhas = planejarConciliacao(
      [pedido({ id: "p1" })],
      [nota({ id: "n1", qtdBase: 60 }), nota({ id: "n2", qtdBase: 40 })],
    );
    expect(linhas.map((l) => [l.qtdPedida, l.status])).toEqual([
      [60, "OK"],
      [60, "FALTANDO"],
    ]);
  });

  it("lotes que passam do saldo: a última linha leva o excesso", () => {
    const linhas = planejarConciliacao(
      [pedido({ id: "p1" })],
      [nota({ id: "n1", qtdBase: 100 }), nota({ id: "n2", qtdBase: 40 })],
    );
    expect(linhas.map((l) => [l.qtdPedida, l.status])).toEqual([
      [100, "OK"],
      [20, "EXCEDENTE"],
    ]);
  });

  it("brinde listado antes da compra não come a linha comprada", () => {
    const linhas = planejarConciliacao(
      [pedido({ id: "compra" }), pedido({ id: "brinde", compra: false, saldo: 12, custoBase: 0 })],
      [
        nota({ id: "n-brinde", bonificacao: true, qtdBase: 12, custoBase: 0 }),
        nota({ id: "n-compra" }),
      ],
    );
    const porNota = new Map(linhas.map((l) => [l.inboundItemId, l]));
    expect(porNota.get("n-brinde")).toMatchObject({ purchaseOrderItemId: "brinde", status: "OK" });
    expect(porNota.get("n-compra")).toMatchObject({ purchaseOrderItemId: "compra", status: "OK" });
  });

  it("brinde sem linha de brinde no pedido: só usa a comprada se ela sobrou", () => {
    // A compra casa primeiro com a compra; o brinde fica "fora do pedido" em
    // vez de roubar a linha comprada (que derrubaria o preço para zero).
    const linhas = planejarConciliacao(
      [pedido({ id: "compra" })],
      [nota({ id: "n-brinde", bonificacao: true, qtdBase: 12, custoBase: 0 }), nota({ id: "n-compra" })],
    );
    const porNota = new Map(linhas.map((l) => [l.inboundItemId, l]));
    expect(porNota.get("n-compra")).toMatchObject({ purchaseOrderItemId: "compra", status: "OK" });
    expect(porNota.get("n-brinde")).toMatchObject({ purchaseOrderItemId: null, status: "NAO_PEDIDO" });
  });

  it("o pedido comprou e o fornecedor mandou de graça: casa e acusa o preço", () => {
    const [l] = planejarConciliacao(
      [pedido({ id: "compra" })],
      [nota({ id: "n1", bonificacao: true, custoBase: 0 })],
    );
    expect(l).toMatchObject({ purchaseOrderItemId: "compra", status: "PRECO_ALTERADO" });
  });

  it("item da nota ainda sem produto fica fora do pedido", () => {
    const linhas = planejarConciliacao([pedido({ id: "p1" })], [nota({ id: "n1", productId: null })]);
    expect(linhas[0]).toMatchObject({ inboundItemId: "n1", purchaseOrderItemId: null, status: "NAO_PEDIDO" });
    expect(linhas[1]).toMatchObject({ purchaseOrderItemId: "p1", status: "NAO_FATURADO" });
  });

  it("veio de novo o que já tinha chegado inteiro: EXCEDENTE contra saldo zero", () => {
    const [l] = planejarConciliacao([pedido({ id: "p1", saldo: 0 })], [nota({ id: "n1", qtdBase: 24 })]);
    expect(l).toMatchObject({ purchaseOrderItemId: "p1", qtdPedida: 0, status: "EXCEDENTE" });
  });

  it("preço diferente com quantidade certa", () => {
    const [l] = planejarConciliacao([pedido({ id: "p1" })], [nota({ id: "n1", custoBase: 5.6 })]);
    expect(l.status).toBe("PRECO_ALTERADO");
  });
});

describe("mesclarContagemAnterior", () => {
  const anterior = (over: Partial<ConferenciaAnterior>): ConferenciaAnterior => ({
    inboundItemId: null,
    purchaseOrderItemId: null,
    status: "OK",
    qtdRecebida: null,
    lote: null,
    validade: null,
    resolucao: null,
    motivoDivergencia: null,
    ...over,
  });

  it("a linha da nota herda a contagem, o lote e a validade", () => {
    const [l] = mesclarContagemAnterior(
      [{ inboundItemId: "n1", purchaseOrderItemId: "p1", status: "OK" }],
      [anterior({ inboundItemId: "n1", qtdRecebida: 30, lote: "L9", validade: "2027-01-01" })],
      { decisaoSoComMesmoVeredito: true },
    );
    expect(l).toMatchObject({ qtdRecebida: 30, lote: "L9", validade: "2027-01-01" });
  });

  it("recebimento aberto pelo pedido que ganhou a nota: a contagem passa uma vez só", () => {
    const [a, b] = mesclarContagemAnterior(
      [
        { inboundItemId: "n1", purchaseOrderItemId: "p1", status: "OK" },
        { inboundItemId: "n2", purchaseOrderItemId: "p1", status: "OK" },
      ],
      [anterior({ purchaseOrderItemId: "p1", qtdRecebida: 120 })],
      { decisaoSoComMesmoVeredito: true },
    );
    expect(a.qtdRecebida).toBe(120);
    // A segunda linha do mesmo item NÃO herda o mesmo número — seria contar
    // duas vezes a mesma caixa.
    expect(b.qtdRecebida).toBeNull();
  });

  it("a decisão sobre a divergência só vale enquanto o veredito é o mesmo", () => {
    const anteriores = [
      anterior({ inboundItemId: "n1", status: "FALTANDO", resolucao: "ACEITO", motivoDivergencia: "ok" }),
    ];
    const [mudou] = mesclarContagemAnterior(
      [{ inboundItemId: "n1", purchaseOrderItemId: "p1", status: "OK" }],
      anteriores,
      { decisaoSoComMesmoVeredito: true },
    );
    expect(mudou).toMatchObject({ resolucao: null, motivoDivergencia: null });

    const [igual] = mesclarContagemAnterior(
      [{ inboundItemId: "n1", purchaseOrderItemId: "p1", status: "FALTANDO" }],
      anteriores,
      { decisaoSoComMesmoVeredito: true },
    );
    expect(igual).toMatchObject({ resolucao: "ACEITO", motivoDivergencia: "ok" });
  });

  it("sem pedido (tudo OK), a decisão registrada sempre vale", () => {
    const [l] = mesclarContagemAnterior(
      [{ inboundItemId: "n1", purchaseOrderItemId: null, status: "OK" }],
      [anterior({ inboundItemId: "n1", status: "OK", motivoDivergencia: "veio amassado" })],
      { decisaoSoComMesmoVeredito: false },
    );
    expect(l.motivoDivergencia).toBe("veio amassado");
  });

  it("linha nova sem par anterior nasce sem contagem", () => {
    const [l] = mesclarContagemAnterior(
      [{ inboundItemId: "n9", purchaseOrderItemId: null, status: "OK" }],
      [anterior({ inboundItemId: "n1", qtdRecebida: 5 })],
      { decisaoSoComMesmoVeredito: true },
    );
    expect(l).toMatchObject({ qtdRecebida: null, lote: null, validade: null, resolucao: null });
  });

  it("linha acrescentada na doca (sem nota nem pedido) não é casada — quem a preserva é o serviço", () => {
    const [l] = mesclarContagemAnterior(
      [{ inboundItemId: null, purchaseOrderItemId: "p1", status: "NAO_FATURADO" }],
      [anterior({ qtdRecebida: 12 })],
      { decisaoSoComMesmoVeredito: true },
    );
    expect(l.qtdRecebida).toBeNull();
  });
});
