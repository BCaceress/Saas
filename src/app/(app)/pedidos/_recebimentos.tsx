"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PackageCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { receberTransferenciaAction } from "../estoque/actions";
import { fmtQtd, Thumb } from "../cotacoes/_ui";

// ── Conferência de transferência entre lojas ──────────────────
//
// A conferência de COMPRA saiu daqui: virou tela própria em /recebimento/[id],
// com a contagem gravada no banco (PurchaseReconciliationItem) em vez do
// localStorage do aparelho de quem conferia — e com um GoodsReceipt por trás,
// que é a entidade que o pedido aponta.
//
// O que sobrou é a transferência: outro fluxo, outra entidade, sem pedido de
// compra, sem fornecedor e sem NF-e. A diferença aqui não é divergência com
// terceiro — é perda de trânsito entre duas lojas nossas.

type TransferItem = {
  productId: string;
  nome: string;
  sku: string;
  imagemUrl: string | null;
  qtdExpedida: number;
};

export type Transfer = {
  id: string;
  origemNome: string;
  destinoNome: string;
  expedidoEm: string | null;
  observacao: string | null;
  items: TransferItem[];
};

export function TransferReceber({ transfer, onDone }: { transfer: Transfer; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [contagem, setContagem] = useState<Record<string, number>>(() =>
    Object.fromEntries(transfer.items.map((it) => [it.productId, it.qtdExpedida])),
  );

  const setQtd = (productId: string, qtd: number) =>
    setContagem((p) => ({ ...p, [productId]: Math.max(0, qtd) }));

  const temDivergencia = transfer.items.some(
    (it) => (contagem[it.productId] ?? it.qtdExpedida) !== it.qtdExpedida,
  );

  function receber() {
    setError(null);
    const items = transfer.items.map((it) => ({
      productId: it.productId,
      qtdRecebida: contagem[it.productId] ?? it.qtdExpedida,
    }));
    startTransition(async () => {
      try {
        await receberTransferenciaAction({ transferId: transfer.id, items });
        onDone();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao receber.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {transfer.observacao && <p className="text-xs text-faint">{transfer.observacao}</p>}

      <div className="flex flex-col gap-2">
        {transfer.items.map((it) => {
          const recebida = contagem[it.productId] ?? it.qtdExpedida;
          const divergente = recebida !== it.qtdExpedida;
          return (
            <div
              key={it.productId}
              className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2"
            >
              <Thumb url={it.imagemUrl} nome={it.nome} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{it.nome}</p>
                <p className="font-mono text-[11px] text-faint">
                  {it.sku} · expedido {fmtQtd(it.qtdExpedida)}
                </p>
              </div>
              <div className="flex w-28 flex-col gap-1">
                <label className="text-[10px] font-semibold text-faint">Recebido</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={recebida}
                  onChange={(e) => setQtd(it.productId, Number(e.target.value))}
                  className={cn(
                    "rounded-lg border bg-surface px-3 py-1.5 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
                    divergente
                      ? "border-danger text-danger"
                      : "border-line text-ink focus-visible:border-brand",
                  )}
                />
              </div>
            </div>
          );
        })}
      </div>

      {temDivergencia && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          Divergência detectada — a diferença será registrada como perda de trânsito.
        </p>
      )}

      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={receber}
          disabled={pending}
          className="flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-60"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />}
          Confirmar recebimento
        </button>
      </div>
    </div>
  );
}
