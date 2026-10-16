import { beforeEach, describe, expect, it, vi } from "vitest";

// Dois serviços do recebimento com o banco em memória:
//  · o bipe que SOMA no servidor — dois celulares na mesma carga não apagam a
//    caixa um do outro;
//  · a nota que chega depois da mercadoria trazendo o boleto — sem cobrar a
//    carga duas vezes quando a entrada já tem título lançado à mão.

const h = vi.hoisted(() => {
  const estado = {
    linha: null as null | Record<string, unknown>,
    receipt: { status: "EM_CONFERENCIA" } as Record<string, unknown>,
    tituloExistente: null as null | { inboundId: string | null },
  };
  const db = {
    purchaseReconciliationItem: {
      findFirst: vi.fn(async () => (estado.linha ? { ...estado.linha, receipt: { ...estado.receipt } } : null)),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!estado.linha) return { count: 0 };
        if ("qtdRecebida" in where && where.qtdRecebida === null && estado.linha.qtdRecebida != null) {
          return { count: 0 };
        }
        Object.assign(estado.linha, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const l = estado.linha as Record<string, unknown>;
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "increment" in v) {
            l[k] = Number(l[k] ?? 0) + Number((v as { increment: number }).increment);
          } else {
            l[k] = v;
          }
        }
        return { ...l };
      }),
    },
    goodsReceipt: { updateMany: vi.fn(async () => ({ count: 0 })) },
    accountPayable: { findFirst: vi.fn(async () => estado.tituloExistente) },
  };
  return {
    estado,
    db,
    registrarEvento: vi.fn(async () => undefined),
    gerarTitulosDaNota: vi.fn(async () => ({ criados: 2, valorTotal: 480, estimado: false })),
  };
});

vi.mock("@/lib/prisma", () => ({ db: h.db }));
vi.mock("@/lib/numeracao", () => ({ proximoNumeroDocumento: vi.fn() }));
vi.mock("@/lib/estoque", () => ({ registrarEntrada: vi.fn() }));
vi.mock("@/lib/financeiro/contas-pagar", () => ({
  gerarTitulosDaNota: h.gerarTitulosDaNota,
  abaterFaltaNaNota: vi.fn(),
}));
vi.mock("@/lib/fiscal/enriquecer-produto", () => ({ atualizarCustoDeReferencia: vi.fn() }));
vi.mock("@/lib/compras/eventos", () => ({ registrarEvento: h.registrarEvento }));

const { somarContagem, titulosDaNotaQueDocumenta } = await import("@/lib/compras/recebimento");

beforeEach(() => {
  vi.clearAllMocks();
  h.estado.receipt = { status: "EM_CONFERENCIA" };
  h.estado.tituloExistente = null;
  h.estado.linha = {
    id: "l1",
    status: "OK",
    resolucao: null,
    qtdPedida: 24,
    qtdFaturada: 24,
    qtdRecebida: null,
  };
});

describe("somarContagem — o bipe soma no servidor", () => {
  it("o primeiro bipe sai do 'não contado' para o incremento", async () => {
    await expect(somarContagem({ receiptId: "r1", itemId: "l1", incremento: 12, userId: "ana" })).resolves.toBe(12);
    expect(h.estado.linha).toMatchObject({ qtdRecebida: 12, contadoPor: "ana" });
  });

  it("os seguintes somam por cima — inclusive os do outro celular", async () => {
    await somarContagem({ receiptId: "r1", itemId: "l1", incremento: 12, userId: "ana" });
    // O outro conferente bipa a mesma caixa de 6 duas vezes.
    await somarContagem({ receiptId: "r1", itemId: "l1", incremento: 6, userId: "bia" });
    await expect(somarContagem({ receiptId: "r1", itemId: "l1", incremento: 6, userId: "bia" })).resolves.toBe(24);
    expect(h.estado.linha).toMatchObject({ qtdRecebida: 24, contadoPor: "bia" });
  });

  it("chegar ao esperado desfaz o 'ajustado' de antes", async () => {
    Object.assign(h.estado.linha as object, { qtdRecebida: 20, resolucao: "AJUSTADO" });
    await somarContagem({ receiptId: "r1", itemId: "l1", incremento: 4 });
    expect((h.estado.linha as Record<string, unknown>).resolucao).toBeNull();
  });

  it("bipe em fração ou zero é recusado", async () => {
    await expect(somarContagem({ receiptId: "r1", itemId: "l1", incremento: 0.5 })).rejects.toThrow(/inteiras/);
    await expect(somarContagem({ receiptId: "r1", itemId: "l1", incremento: 0 })).rejects.toThrow(/inteiras/);
  });

  it("recebimento encerrado não aceita bipe", async () => {
    h.estado.receipt = { status: "FINALIZADO" };
    await expect(somarContagem({ receiptId: "r1", itemId: "l1", incremento: 1 })).rejects.toThrow(/encerrado/);
    expect(h.db.purchaseReconciliationItem.updateMany).not.toHaveBeenCalled();
  });
});

describe("titulosDaNotaQueDocumenta — o boleto que chega com a nota atrasada", () => {
  const entrada = {
    tenantId: "t1",
    inboundId: "nfe-1",
    purchaseIds: ["compra-1", "compra-2"],
    receiptId: "rec-1",
    purchaseOrderId: null,
    userId: "ana",
  };

  it("sem título nenhum, as duplicatas da nota viram títulos — na primeira entrada", async () => {
    await expect(titulosDaNotaQueDocumenta(entrada)).resolves.toBe("");
    expect(h.gerarTitulosDaNota).toHaveBeenCalledWith(
      expect.objectContaining({ inboundId: "nfe-1", purchaseId: "compra-1" }),
    );
    expect(h.registrarEvento).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: "TITULOS_GERADOS", receiptId: "rec-1" }),
    );
  });

  it("entrada com título lançado à mão não ganha outro: avisa para conferir", async () => {
    h.estado.tituloExistente = { inboundId: null };
    await expect(titulosDaNotaQueDocumenta(entrada)).resolves.toMatch(/lançado à mão/);
    expect(h.gerarTitulosDaNota).not.toHaveBeenCalled();
  });

  it("se os títulos já são desta nota, não diz nada e não duplica", async () => {
    h.estado.tituloExistente = { inboundId: "nfe-1" };
    await expect(titulosDaNotaQueDocumenta(entrada)).resolves.toBe("");
    expect(h.gerarTitulosDaNota).not.toHaveBeenCalled();
  });

  it("sem entrada a documentar, nada a gerar", async () => {
    await titulosDaNotaQueDocumenta({ ...entrada, purchaseIds: [] });
    expect(h.db.accountPayable.findFirst).not.toHaveBeenCalled();
    expect(h.gerarTitulosDaNota).not.toHaveBeenCalled();
  });
});
