"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Loader2, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { registrarTransferenciaAction } from "../actions";

type Site = { id: string; nome: string; tipo: string };
type Product = { id: string; nome: string; sku: string };
type Saldo = { productId: string; siteId: string; saldo: number };
type Item = { productId: string; quantidade: number };

export function TransferenciaForm({
  sites,
  products,
  saldos,
  embedded = false,
  onDone,
}: {
  sites: Site[];
  products: Product[];
  saldos: Saldo[];
  /** Quando usado dentro de um sidepanel: não navega, chama onDone + refresh. */
  embedded?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [origemId, setOrigemId] = useState(sites[0]?.id ?? "");
  const [destinoId, setDestinoId] = useState(sites[1]?.id ?? "");
  const [observacao, setObservacao] = useState("");
  const [items, setItems] = useState<Item[]>([{ productId: "", quantidade: 1 }]);

  // Saldo do produto na origem selecionada (0 se não houver).
  const saldoNaOrigem = (productId: string) =>
    saldos.find((s) => s.productId === productId && s.siteId === origemId)?.saldo ?? 0;

  // Só produtos com saldo > 0 na origem aparecem na lista.
  const disponiveis = products.filter((p) => saldoNaOrigem(p.id) > 0);

  function addItem() {
    setItems((p) => [...p, { productId: "", quantidade: 1 }]);
  }

  function removeItem(idx: number) {
    setItems((p) => p.filter((_, i) => i !== idx));
  }

  function updateItem(idx: number, patch: Partial<Item>) {
    setItems((p) => p.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  }

  function submit() {
    setError(null);
    const valid = items.filter((i) => i.productId && i.quantidade > 0);
    if (valid.length === 0) { setError("Adicione ao menos um item."); return; }
    if (origemId === destinoId) { setError("Origem e destino devem ser diferentes."); return; }
    const semSaldo = valid.find((i) => i.quantidade > saldoNaOrigem(i.productId));
    if (semSaldo) {
      const p = products.find((pp) => pp.id === semSaldo.productId);
      setError(`Quantidade acima do saldo de "${p?.nome ?? "produto"}" na origem (disp.: ${saldoNaOrigem(semSaldo.productId)}).`);
      return;
    }

    startTransition(async () => {
      try {
        await registrarTransferenciaAction({
          origemSiteId: origemId,
          destinoSiteId: destinoId,
          observacao: observacao || null,
          items: valid,
        });
        if (embedded) {
          router.refresh();
          onDone?.();
        } else {
          router.push("/estoque");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao transferir.");
      }
    });
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      {/* Origem → Destino */}
      <div className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-5">
        <div className="flex flex-1 flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-faint">Origem</label>
          <select
            value={origemId}
            onChange={(e) => {
              setOrigemId(e.target.value);
              setItems([{ productId: "", quantidade: 1 }]); // origem mudou: limpa itens
            }}
            className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            {sites.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </div>
        <ArrowRight size={18} className="mt-5 shrink-0 text-muted" />
        <div className="flex flex-1 flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-faint">Destino</label>
          <select
            value={destinoId}
            onChange={(e) => setDestinoId(e.target.value)}
            className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            {sites.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </div>
      </div>

      {/* Items */}
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-faint">Itens a transferir</p>
        {disponiveis.length === 0 && (
          <p className="rounded-[var(--radius)] bg-surface-2 px-4 py-3 text-sm text-muted">
            Nenhum produto com saldo na origem selecionada.
          </p>
        )}
        {items.map((item, idx) => (
          <div key={idx} className="flex items-end gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4">
            <div className="flex flex-1 flex-col gap-1">
              <label className="text-[11px] font-semibold text-faint">Produto</label>
              <select
                value={item.productId}
                onChange={(e) => updateItem(idx, { productId: e.target.value })}
                className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <option value="">Selecione...</option>
                {disponiveis.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome} ({p.sku}) · {saldoNaOrigem(p.id)} disp.
                  </option>
                ))}
              </select>
            </div>
            <div className="flex w-28 flex-col gap-1">
              <label className="text-[11px] font-semibold text-faint">Qtd (un)</label>
              <input
                type="number"
                min={1}
                step={1}
                max={item.productId ? saldoNaOrigem(item.productId) : undefined}
                value={item.quantidade}
                onChange={(e) => updateItem(idx, { quantidade: Number(e.target.value) })}
                className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink tabular-nums focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              />
            </div>
            <button
              type="button"
              onClick={() => removeItem(idx)}
              disabled={items.length === 1}
              className="mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-danger transition-colors hover:bg-danger-soft disabled:opacity-30"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addItem}
          className="flex items-center gap-2 self-start rounded-full border border-dashed border-line px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-brand hover:text-brand"
        >
          <Plus size={15} /> Adicionar item
        </button>
      </div>

      {/* Observação */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold uppercase tracking-wide text-faint">Observação (opcional)</label>
        <input
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="Ex: Reposição da loja 2"
          className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
      </div>

      {error && <p className="rounded-[var(--radius)] bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</p>}

      <div className="flex justify-end gap-3 border-t border-line pt-4">
        <button
          type="button"
          onClick={() => (embedded ? onDone?.() : router.back())}
          className="rounded-full border border-line px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-60"
        >
          {pending && <Loader2 size={14} className="animate-spin" />}
          Confirmar transferência
        </button>
      </div>
    </div>
  );
}
