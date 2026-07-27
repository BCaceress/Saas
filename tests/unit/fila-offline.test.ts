import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  enfileirarVendaOffline,
  listarVendasOffline,
  removerVendaOffline,
  contarVendasOffline,
  type VendaOfflinePayload,
} from "@/lib/offline/fila-vendas";

// A fila offline guarda vendas em dinheiro fechadas sem rede. É caminho de
// dinheiro: idempotência (não duplicar), ordem e remoção após sync.
function venda(clientId: string, criadaEm: string): VendaOfflinePayload {
  return {
    clientId,
    siteId: "site1",
    cashSessionId: "cx1",
    customerId: null,
    items: [{ productId: "p1", variantId: null, quantidade: 1, selecoes: [] }],
    descontoVenda: 0,
    maiorIdadeConfirmada: false,
    cpfNota: null,
    pagamentos: [{ metodo: "DINHEIRO", valor: 10 }],
    criadaEm,
    totalEstimado: 10,
  };
}

beforeEach(() => {
  // Banco limpo por teste (fake-indexeddb reinicia o factory global).
  globalThis.indexedDB = new IDBFactory();
});

describe("fila de vendas offline", () => {
  it("enfileira e lista", async () => {
    await enfileirarVendaOffline(venda("a", "2026-01-01T10:00:00Z"));
    await enfileirarVendaOffline(venda("b", "2026-01-01T10:01:00Z"));
    expect(await contarVendasOffline()).toBe(2);
  });

  it("é idempotente por clientId (put não duplica)", async () => {
    await enfileirarVendaOffline(venda("a", "2026-01-01T10:00:00Z"));
    await enfileirarVendaOffline(venda("a", "2026-01-01T10:00:00Z"));
    expect(await contarVendasOffline()).toBe(1);
  });

  it("lista em ordem de criação (mais antiga primeiro)", async () => {
    await enfileirarVendaOffline(venda("nova", "2026-01-01T12:00:00Z"));
    await enfileirarVendaOffline(venda("velha", "2026-01-01T08:00:00Z"));
    const fila = await listarVendasOffline();
    expect(fila.map((v) => v.clientId)).toEqual(["velha", "nova"]);
  });

  it("remove após sincronizar", async () => {
    await enfileirarVendaOffline(venda("a", "2026-01-01T10:00:00Z"));
    await removerVendaOffline("a");
    expect(await contarVendasOffline()).toBe(0);
  });
});
