import { beforeEach, describe, expect, it, vi } from "vitest";

// Os serviços do recebimento com o banco trocado por um dublê em memória. O que
// se prova aqui não é o SQL — é a ordem das coisas: a trava que impede a mesma
// carga de entrar duas vezes, o destravamento quando nada chegou a entrar, o
// que a linha não faturada deixa (ou não) no estoque, e a linha acrescentada
// na doca sobrevivendo a uma remontagem da conferência.

type Linha = Record<string, unknown> & { id: string };

const h = vi.hoisted(() => {
  const estado = {
    receipt: {} as Record<string, unknown>,
    linhas: [] as Linha[],
    purchases: [] as { receiptId: string; estornadaEm: Date | null }[],
    criadas: [] as Linha[],
    apagadasWhere: null as unknown,
    atualizadasAvulsas: null as unknown,
    inbound: {} as Record<string, unknown>,
    pedido: {} as Record<string, unknown>,
  };

  const statusCasa = (where: Record<string, unknown>, status: unknown) => {
    const s = where.status as { in?: unknown[] } | string | undefined;
    if (s == null) return true;
    if (typeof s === "string") return s === status;
    return Array.isArray(s.in) ? s.in.includes(status) : true;
  };

  const db = {
    goodsReceipt: {
      findFirst: vi.fn(async () => ({ ...estado.receipt })),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: object }) => {
        if (!statusCasa(where, estado.receipt.status)) return { count: 0 };
        Object.assign(estado.receipt, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: { data: object }) => {
        Object.assign(estado.receipt, data);
        return { ...estado.receipt };
      }),
    },
    purchaseReconciliationItem: {
      findMany: vi.fn(async () => estado.linhas.map((l) => ({ ...l }))),
      deleteMany: vi.fn(async ({ where }: { where: unknown }) => {
        estado.apagadasWhere = where;
        return { count: 0 };
      }),
      updateMany: vi.fn(async (args: unknown) => {
        estado.atualizadasAvulsas = args;
        return { count: 0 };
      }),
      createMany: vi.fn(async ({ data }: { data: Linha[] }) => {
        estado.criadas.push(...data);
        return { count: data.length };
      }),
    },
    purchaseOrderItem: {
      findMany: vi.fn(async () => [
        { id: "poi-1", tipo: "COMPRA", packagingId: null, qtdPedida: 24, qtdRecebida: 0 },
        { id: "poi-2", tipo: "COMPRA", packagingId: null, qtdPedida: 12, qtdRecebida: 0 },
      ]),
      update: vi.fn(async () => ({})),
    },
    purchaseOrder: {
      findFirst: vi.fn(async () => ({ ...estado.pedido })),
      update: vi.fn(async () => ({})),
    },
    fiscalInbound: {
      findFirst: vi.fn(async () => ({ ...estado.inbound })),
      update: vi.fn(async () => ({})),
    },
    purchase: {
      count: vi.fn(async () => estado.purchases.filter((p) => !p.estornadaEm).length),
    },
    productPackaging: { findMany: vi.fn(async () => []) },
    product: {
      findMany: vi.fn(async () => [{ id: "heineken", nome: "Heineken LN 330" }]),
    },
  };

  return {
    estado,
    db,
    registrarEntrada: vi.fn(),
    registrarEvento: vi.fn(async () => undefined),
    gerarTitulosDaNota: vi.fn(async () => ({ criados: 0, valorTotal: 0, estimado: false })),
    abaterFaltaNaNota: vi.fn(async (input: { valor: number }) => ({ abatido: input.valor, sobra: 0 })),
    atualizarCustoDeReferencia: vi.fn(async () => undefined),
    garantirRecebimentoDaNota: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({ db: h.db }));
vi.mock("@/lib/numeracao", () => ({ proximoNumeroDocumento: vi.fn(async () => "REC-00001") }));
vi.mock("@/lib/estoque", () => ({
  registrarEntrada: h.registrarEntrada,
  criarPedidoCompra: vi.fn(),
  registrarDevolucao: vi.fn(),
}));
vi.mock("@/lib/financeiro/contas-pagar", () => ({
  gerarTitulosDaNota: h.gerarTitulosDaNota,
  abaterFaltaNaNota: h.abaterFaltaNaNota,
}));
vi.mock("@/lib/fiscal/enriquecer-produto", () => ({
  atualizarCustoDeReferencia: h.atualizarCustoDeReferencia,
}));
vi.mock("@/lib/compras/eventos", () => ({ registrarEvento: h.registrarEvento }));

const { finalizarRecebimento } = await import("@/lib/compras/recebimento");

const linhaBase = (over: Partial<Linha> & { id: string }): Linha => ({
  productId: "heineken",
  descricao: "Heineken LN 330",
  status: "OK",
  qtdPedida: 0,
  qtdFaturada: 0,
  qtdRecebida: null,
  custoPedido: 0,
  custoFaturado: 0,
  bonificacao: false,
  resolucao: null,
  motivoDivergencia: null,
  lote: null,
  validade: null,
  purchaseOrderItemId: null,
  ...over,
});

function recebimentoAvulso() {
  h.estado.receipt = {
    id: "rec-1",
    numero: "REC-00001",
    status: "EM_CONFERENCIA",
    origem: "AVULSO",
    siteId: "loja-1",
    supplierId: null,
    numeroNota: null,
    purchaseOrderId: null,
    inboundId: null,
    inbound: null,
    purchaseOrder: null,
  };
  h.estado.linhas = [linhaBase({ id: "l1", status: "NAO_PEDIDO", qtdRecebida: 10, custoFaturado: 5 })];
}

function recebimentoDoPedidoComNota() {
  h.estado.receipt = {
    id: "rec-2",
    numero: "REC-00002",
    status: "EM_CONFERENCIA",
    origem: "XML",
    siteId: "loja-1",
    supplierId: "forn-1",
    numeroNota: null,
    purchaseOrderId: "pc-1",
    inboundId: "nfe-1",
    inbound: {
      id: "nfe-1",
      numero: 123,
      serie: 1,
      chave: "3526",
      status: "CONCILIADO",
      supplierId: "forn-1",
      emitRazaoSocial: "Distribuidora",
    },
    purchaseOrder: { id: "pc-1", numero: "PC-00001", status: "AGUARDANDO", financeiroGerado: false },
  };
  h.estado.linhas = [
    // Faturado e não contado: entra pela nota.
    linhaBase({
      id: "l-nota",
      status: "OK",
      qtdPedida: 24,
      qtdFaturada: 24,
      custoPedido: 5,
      custoFaturado: 5,
      purchaseOrderItemId: "poi-1",
    }),
    // Estava no pedido e a nota não trouxe; ninguém contou.
    linhaBase({
      id: "l-nf",
      productId: "coca",
      descricao: "Coca 2L",
      status: "NAO_FATURADO",
      qtdPedida: 12,
      qtdFaturada: 0,
      custoPedido: 7,
      custoFaturado: 0,
      purchaseOrderItemId: "poi-2",
    }),
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  h.estado.purchases = [];
  h.registrarEntrada.mockImplementation(async (_t: string, _s: string, _i: unknown, opts: { receiptId: string }) => {
    h.estado.purchases.push({ receiptId: opts.receiptId, estornadaEm: null });
    return `compra-${h.estado.purchases.length}`;
  });
});

describe("finalizarRecebimento — a trava contra a entrada em dobro", () => {
  it("dois cliques ao mesmo tempo: só um dá entrada, o outro é recusado", async () => {
    recebimentoAvulso();
    const [a, b] = await Promise.allSettled([
      finalizarRecebimento({ tenantId: "t1", receiptId: "rec-1" }),
      finalizarRecebimento({ tenantId: "t1", receiptId: "rec-1" }),
    ]);

    const ok = [a, b].filter((r) => r.status === "fulfilled");
    const recusado = [a, b].filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(recusado).toHaveLength(1);
    expect(String(recusado[0].reason)).toMatch(/acabou de ser finalizado/);
    expect(h.registrarEntrada).toHaveBeenCalledTimes(1);
    expect(h.estado.receipt.status).toBe("FINALIZADO");
  });

  it("se nada chegou a entrar, o recebimento destrava para tentar de novo", async () => {
    recebimentoAvulso();
    h.registrarEntrada.mockRejectedValueOnce(new Error("conexão caiu"));

    await expect(finalizarRecebimento({ tenantId: "t1", receiptId: "rec-1" })).rejects.toThrow(
      "conexão caiu",
    );
    expect(h.estado.receipt.status).toBe("EM_CONFERENCIA");
    expect(h.estado.receipt.finalizadoEm).toBeNull();
  });

  it("se uma entrada já foi lançada, ele fica fechado — destravar lançaria tudo de novo", async () => {
    recebimentoAvulso();
    h.estado.linhas.push(
      linhaBase({ id: "l2", productId: "brinde", status: "NAO_PEDIDO", qtdRecebida: 2, bonificacao: true }),
    );
    // A compra entra; a bonificação (segunda entrada) falha.
    h.registrarEntrada
      .mockImplementationOnce(async (_t: string, _s: string, _i: unknown, opts: { receiptId: string }) => {
        h.estado.purchases.push({ receiptId: opts.receiptId, estornadaEm: null });
        return "compra-1";
      })
      .mockRejectedValueOnce(new Error("falhou no meio"));

    await expect(finalizarRecebimento({ tenantId: "t1", receiptId: "rec-1" })).rejects.toThrow(
      "falhou no meio",
    );
    expect(h.estado.receipt.status).toBe("FINALIZADO");
  });

  it("recebimento já encerrado nem chega a mexer no estoque", async () => {
    recebimentoAvulso();
    h.estado.receipt.status = "FINALIZADO";
    await expect(finalizarRecebimento({ tenantId: "t1", receiptId: "rec-1" })).rejects.toThrow(
      /já foi finalizado/,
    );
    expect(h.registrarEntrada).not.toHaveBeenCalled();
  });

  it("validação recusada não trava o recebimento", async () => {
    recebimentoAvulso();
    h.estado.linhas = [linhaBase({ id: "l1", productId: null, status: "NAO_PEDIDO", qtdRecebida: 3 })];
    await expect(finalizarRecebimento({ tenantId: "t1", receiptId: "rec-1" })).rejects.toThrow(
      /Relacione ao produto/,
    );
    expect(h.estado.receipt.status).toBe("EM_CONFERENCIA");
  });
});

describe("finalizarRecebimento — o que entra", () => {
  it("avulso puro não pede explicação de 'divergência' do que a doca acrescentou", async () => {
    recebimentoAvulso();
    await expect(finalizarRecebimento({ tenantId: "t1", receiptId: "rec-1" })).resolves.toMatchObject({
      itens: 1,
      valorRecebido: 50,
    });
  });

  it("linha não faturada e não contada NÃO entra — nem fecha o pedido", async () => {
    recebimentoDoPedidoComNota();
    const r = await finalizarRecebimento({ tenantId: "t1", receiptId: "rec-2" });

    expect(h.registrarEntrada).toHaveBeenCalledTimes(1);
    const itens = h.registrarEntrada.mock.calls[0][2] as { productId: string; quantidade: number }[];
    expect(itens).toEqual([expect.objectContaining({ productId: "heineken", quantidade: 24 })]);
    // O item que não veio continua esperado: o pedido fica parcial.
    expect(r.pedidoCompleto).toBe(false);
    expect(h.db.purchaseOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "RECEBIDO_PARCIAL" }) }),
    );
  });

  it("não faturado que chegou mesmo assim entra pelo preço do pedido, não a zero", async () => {
    recebimentoDoPedidoComNota();
    h.estado.linhas[1].qtdRecebida = 12;
    await finalizarRecebimento({
      tenantId: "t1",
      receiptId: "rec-2",
      motivoDivergencia: "veio no caminhão sem nota",
    });

    const itens = h.registrarEntrada.mock.calls[0][2] as { productId: string; custoTotal: number }[];
    const coca = itens.find((i) => i.productId === "coca");
    expect(coca?.custoTotal).toBe(12 * 7);
  });

  it("linha dividida em lotes entra uma fatia por lote, e o resto sem lote", async () => {
    recebimentoAvulso();
    h.estado.linhas[0].lotes = [{ lote: "A", validade: "2026-11-01", quantidade: 6 }];
    await finalizarRecebimento({ tenantId: "t1", receiptId: "rec-1" });

    const itens = h.registrarEntrada.mock.calls[0][2] as {
      quantidade: number;
      lote: string | null;
      validade: string | null;
      custoTotal: number;
    }[];
    expect(itens).toEqual([
      expect.objectContaining({ quantidade: 6, lote: "A", validade: "2026-11-01", custoTotal: 30 }),
      expect.objectContaining({ quantidade: 4, lote: null, validade: null, custoTotal: 20 }),
    ]);
  });

  it("a falta da nota é abatida do título quando a pessoa pede", async () => {
    recebimentoDoPedidoComNota();
    // A nota cobra 24; chegaram 20.
    Object.assign(h.estado.linhas[0], { inboundItemId: "item-1", qtdRecebida: 20 });
    const r = await finalizarRecebimento({
      tenantId: "t1",
      receiptId: "rec-2",
      motivoDivergencia: "4 garrafas quebradas, recusadas na porta",
      abaterFalta: true,
    });

    expect(h.abaterFaltaNaNota).toHaveBeenCalledWith(
      expect.objectContaining({ inboundId: "nfe-1", valor: 20 }),
    );
    expect(r.faltaAbatida).toBe(20);
  });

  it("sem pedir, a falta não mexe no título", async () => {
    recebimentoDoPedidoComNota();
    Object.assign(h.estado.linhas[0], { inboundItemId: "item-1", qtdRecebida: 20 });
    const r = await finalizarRecebimento({
      tenantId: "t1",
      receiptId: "rec-2",
      motivoDivergencia: "4 garrafas quebradas",
    });
    expect(h.abaterFaltaNaNota).not.toHaveBeenCalled();
    expect(r.faltaAbatida).toBe(0);
  });

  it("não faturado contado exige a frase da divergência", async () => {
    recebimentoDoPedidoComNota();
    h.estado.linhas[1].qtdRecebida = 12;
    await expect(finalizarRecebimento({ tenantId: "t1", receiptId: "rec-2" })).rejects.toThrow(
      /Explique a diferença/,
    );
    expect(h.registrarEntrada).not.toHaveBeenCalled();
  });
});

describe("conciliar — remontar a conferência", () => {
  it("a linha acrescentada na doca sobrevive, e a contagem passa para a linha nova", async () => {
    vi.resetModules();
    vi.doMock("@/lib/compras/recebimento", () => ({
      garantirRecebimentoDaNota: vi.fn(async () => ({ id: "rec-3" })),
      fatoresDe: vi.fn(async () => new Map()),
    }));
    const { conciliar } = await import("@/lib/compras/conciliacao");

    h.estado.criadas = [];
    h.estado.inbound = {
      id: "nfe-3",
      status: "CONCILIADO",
      numero: 9,
      serie: 1,
      siteId: "loja-1",
      supplierId: "forn-1",
      items: [
        {
          id: "item-1",
          descricao: "CERV HEINEKEN LN 330ML",
          codigoFornecedor: "0042",
          gtin: "789",
          quantidade: 2,
          fatorConversao: 12,
          productId: "heineken",
          bonificacao: false,
          valorTotal: 120,
          valorDesconto: 0,
          valorIcmsSt: 0,
          valorFcpSt: 0,
          valorIpi: 0,
          valorFrete: 0,
        },
      ],
    };
    h.estado.pedido = {
      id: "pc-3",
      numero: "PC-00003",
      siteId: "loja-1",
      status: "AGUARDANDO",
      items: [
        {
          id: "poi-9",
          productId: "heineken",
          packagingId: null,
          tipo: "COMPRA",
          qtdPedida: 24,
          qtdRecebida: 0,
          custoUnitario: 5,
        },
      ],
    };
    h.estado.linhas = [
      // Já contada na remontagem anterior.
      linhaBase({
        id: "velha",
        inboundItemId: "item-1",
        purchaseOrderItemId: "poi-9",
        qtdRecebida: 20,
        lote: "L1",
      }),
      // Acrescentada na doca: "veio a mais".
      linhaBase({ id: "avulsa", inboundItemId: null, purchaseOrderItemId: null, qtdRecebida: 6 }),
    ];

    await conciliar({ tenantId: "t1", inboundId: "nfe-3", purchaseOrderId: "pc-3" });

    // Só as linhas que nascem de documento são apagadas…
    expect(h.estado.apagadasWhere).toEqual({
      receiptId: "rec-3",
      OR: [{ inboundItemId: { not: null } }, { purchaseOrderItemId: { not: null } }],
    });
    // …a avulsa fica, acompanhando o pedido da vez…
    expect(h.estado.atualizadasAvulsas).toEqual({
      where: { id: { in: ["avulsa"] } },
      data: { inboundId: "nfe-3", purchaseOrderId: "pc-3" },
    });
    // …e a linha recriada herda a contagem e o lote.
    expect(h.estado.criadas).toHaveLength(1);
    expect(h.estado.criadas[0]).toMatchObject({
      inboundItemId: "item-1",
      purchaseOrderItemId: "poi-9",
      qtdPedida: 24,
      qtdFaturada: 24,
      status: "OK",
      qtdRecebida: 20,
      lote: "L1",
    });
  });

  it("NF-e vinculada ao avulso contado à mão: a contagem vai para a linha da nota e a avulsa sai", async () => {
    vi.resetModules();
    vi.doMock("@/lib/compras/recebimento", () => ({
      garantirRecebimentoDaNota: vi.fn(async () => ({ id: "rec-4" })),
      fatoresDe: vi.fn(async () => new Map()),
    }));
    const { conferirSemPedido } = await import("@/lib/compras/conciliacao");

    h.estado.criadas = [];
    h.estado.atualizadasAvulsas = null;
    h.estado.inbound = {
      id: "nfe-4",
      status: "PENDENTE",
      numero: 10,
      serie: 1,
      purchaseOrderId: null,
      items: [
        {
          id: "item-9",
          descricao: "CERV HEINEKEN LN 330ML",
          codigoFornecedor: "0042",
          gtin: "789",
          quantidade: 24,
          fatorConversao: 1,
          productId: "heineken",
          bonificacao: false,
          valorTotal: 120,
          valorDesconto: 0,
          valorIcmsSt: 0,
          valorFcpSt: 0,
          valorIpi: 0,
          valorFrete: 0,
        },
      ],
    };
    // Contada na doca antes de o XML chegar.
    h.estado.linhas = [
      linhaBase({
        id: "avulsa-1",
        inboundItemId: null,
        purchaseOrderItemId: null,
        status: "NAO_PEDIDO",
        qtdRecebida: 24,
        lote: "L7",
      }),
    ];

    await conferirSemPedido({ tenantId: "t1", inboundId: "nfe-4", absorverAvulsas: true });

    expect(h.db.purchaseReconciliationItem.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["avulsa-1"] } },
    });
    // Não sobrou avulsa para acompanhar o documento.
    expect(h.estado.atualizadasAvulsas).toBeNull();
    expect(h.estado.criadas).toHaveLength(1);
    expect(h.estado.criadas[0]).toMatchObject({ inboundItemId: "item-9", qtdRecebida: 24, lote: "L7" });
  });

  it("sem o vínculo, remontar não mexe na linha que a doca abriu", async () => {
    vi.resetModules();
    vi.doMock("@/lib/compras/recebimento", () => ({
      garantirRecebimentoDaNota: vi.fn(async () => ({ id: "rec-4" })),
      fatoresDe: vi.fn(async () => new Map()),
    }));
    const { conferirSemPedido } = await import("@/lib/compras/conciliacao");

    h.estado.criadas = [];
    h.estado.linhas = [
      linhaBase({
        id: "avulsa-1",
        inboundItemId: null,
        purchaseOrderItemId: null,
        status: "NAO_PEDIDO",
        qtdRecebida: 24,
      }),
    ];

    await conferirSemPedido({ tenantId: "t1", inboundId: "nfe-4" });

    expect(h.estado.atualizadasAvulsas).toMatchObject({ where: { id: { in: ["avulsa-1"] } } });
    expect(h.estado.criadas[0]).toMatchObject({ inboundItemId: "item-9", qtdRecebida: null });
  });
});
