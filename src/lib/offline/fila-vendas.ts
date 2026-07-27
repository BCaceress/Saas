"use client";

// ============================================================
// Fila local de vendas offline (Fase 3). IndexedDB puro, sem dependência.
//
// Quando o PDV fecha uma venda sem rede (só dinheiro), ela vira um registro
// aqui e some da tela como concluída. Ao voltar a rede, o worker de
// sincronização drena a fila para o servidor (idempotente por `clientId`).
//
// Por que IndexedDB e não memória/localStorage: sobrevive a recarregar/travar
// (a venda não pode sumir) e guarda objetos estruturados sem serializar à mão.
// ============================================================

export type VendaOfflinePayload = {
  clientId: string; // uuid — chave de idempotência no servidor
  siteId: string;
  cashSessionId: string;
  customerId: string | null;
  items: {
    productId: string;
    variantId: string | null;
    quantidade: number;
    selecoes: string[];
  }[];
  descontoVenda: number;
  maiorIdadeConfirmada: boolean;
  cpfNota: string | null;
  pagamentos: { metodo: "DINHEIRO"; valor: number; troco?: number | null }[];
  criadaEm: string; // ISO
  /** Só para exibir na fila local (o servidor recalcula o total). */
  totalEstimado: number;
};

const DB_NAME = "nohub-pdv";
const DB_VERSION = 1;
const STORE = "vendas-offline";

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "clientId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return abrir().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

/** Enfileira uma venda offline. Se o clientId já existe, sobrescreve (idempotente). */
export function enfileirarVendaOffline(venda: VendaOfflinePayload): Promise<IDBValidKey> {
  return tx("readwrite", (s) => s.put(venda));
}

/** Todas as vendas na fila, mais antigas primeiro (ordem de criação). */
export function listarVendasOffline(): Promise<VendaOfflinePayload[]> {
  return tx<VendaOfflinePayload[]>("readonly", (s) => s.getAll()).then((v) =>
    v.sort((a, b) => a.criadaEm.localeCompare(b.criadaEm)),
  );
}

/** Remove uma venda da fila (após sincronizar com sucesso). */
export function removerVendaOffline(clientId: string): Promise<void> {
  return tx("readwrite", (s) => s.delete(clientId)).then(() => undefined);
}

/** Quantas vendas aguardam sincronização. */
export function contarVendasOffline(): Promise<number> {
  return tx<number>("readonly", (s) => s.count());
}
