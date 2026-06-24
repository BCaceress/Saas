"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { registrarEntradaAction } from "../../actions";
import { cn } from "@/lib/utils";

type Product = {
  id: string;
  nome: string;
  sku: string;
  packagings: { id: string; nome: string; fatorConversao: unknown }[];
  suppliers: { supplierId: string }[];
  brand: { nome: string } | null;
};

type Supplier = { id: string; razaoSocial: string; nomeFantasia: string | null };
type Site = { id: string; nome: string; tipo: string };

type Item = {
  productId: string;
  quantidade: number;
  custoTotal: number;
  custoDisplay: string;
  packagingId: string | null;
};

export function NovaEntradaForm({
  products,
  suppliers,
  sites,
}: {
  products: Product[];
  suppliers: Supplier[];
  sites: Site[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [tipo, setTipo] = useState<"MANUAL" | "FORNECEDOR">("MANUAL");
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [supplierId, setSupplierId] = useState("");
  const [numeroNota, setNumeroNota] = useState("");
  const [observacao, setObservacao] = useState("");
  const [items, setItems] = useState<Item[]>([
    { productId: "", quantidade: 1, custoTotal: 0, custoDisplay: "", packagingId: null },
  ]);

  function addItem() {
    setItems((prev) => [...prev, { productId: "", quantidade: 1, custoTotal: 0, custoDisplay: "", packagingId: null }]);
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateItem(idx: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  }

  // Por fornecedor: só os produtos vinculados ao fornecedor selecionado.
  const availableProducts = useMemo(() => {
    if (tipo === "FORNECEDOR" && supplierId) {
      return products.filter((p) => p.suppliers.some((s) => s.supplierId === supplierId));
    }
    return products;
  }, [products, tipo, supplierId]);

  // Ao trocar de fornecedor, limpa itens cujo produto não pertence a ele.
  function changeSupplier(id: string) {
    setSupplierId(id);
    if (!id) return;
    setItems((prev) =>
      prev.map((it) => {
        const allowed = products
          .find((p) => p.id === it.productId)
          ?.suppliers.some((s) => s.supplierId === id);
        return it.productId && !allowed ? { ...it, productId: "", packagingId: null } : it;
      }),
    );
  }

  function submit() {
    setError(null);
    const valid = items.filter((i) => i.productId && i.quantidade > 0);
    if (valid.length === 0) { setError("Adicione ao menos um item."); return; }
    if (!siteId) { setError("Selecione o local."); return; }

    startTransition(async () => {
      try {
        await registrarEntradaAction({
          siteId,
          tipo,
          supplierId: tipo === "FORNECEDOR" ? supplierId || null : null,
          numeroNota: numeroNota || null,
          observacao: observacao || null,
          items: valid,
        });
        router.push("/estoque/entradas");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao registrar.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header fields */}
      <div className="grid gap-4 rounded-[var(--radius-lg)] border border-line bg-surface p-5 sm:grid-cols-2">
        {/* Local */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-faint">Local</label>
          {sites.length > 1 ? (
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.nome}</option>
              ))}
            </select>
          ) : (
            <div className="rounded-[var(--radius)] border border-line bg-surface-2 px-3 py-2.5 text-sm font-medium text-ink">
              {sites[0]?.nome ?? "—"}
            </div>
          )}
        </div>

        {/* Tipo */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-faint">Tipo</label>
          <div className="flex gap-2">
            {(["MANUAL", "FORNECEDOR"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(t)}
                className={cn(
                  "flex-1 rounded-[var(--radius)] border px-3 py-2.5 text-sm font-medium transition-colors",
                  tipo === t
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-line text-muted hover:bg-surface-2"
                )}
              >
                {t === "MANUAL" ? "Manual" : "Fornecedor"}
              </button>
            ))}
          </div>
        </div>

        {/* Fornecedor (só FORNECEDOR) */}
        {tipo === "FORNECEDOR" && (
          <>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-faint">Fornecedor</label>
              <select
                value={supplierId}
                onChange={(e) => changeSupplier(e.target.value)}
                className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <option value="">Selecione...</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.nomeFantasia ?? s.razaoSocial}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-faint">Nº da nota (opcional)</label>
              <input
                value={numeroNota}
                onChange={(e) => setNumeroNota(e.target.value)}
                placeholder="Ex: 001234"
                className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              />
            </div>
          </>
        )}

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-faint">Observação (opcional)</label>
          <input
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Ex: Compra de reposição semanal"
            className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
        </div>
      </div>

      {/* Items */}
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-faint">Itens</p>
        {items.map((item, idx) => {
          const prod = products.find((p) => p.id === item.productId);
          const usedIds = new Set(items.filter((_, i) => i !== idx).map((i) => i.productId).filter(Boolean));
          const selectableProducts = availableProducts.filter((p) => !usedIds.has(p.id) || p.id === item.productId);
          return (
            <div
              key={idx}
              className="grid gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]"
            >
              {/* Produto */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-faint">Produto</label>
                <select
                  value={item.productId}
                  onChange={(e) => updateItem(idx, { productId: e.target.value, packagingId: null })}
                  disabled={tipo === "FORNECEDOR" && !supplierId}
                  className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink disabled:opacity-50 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                  <option value="">
                    {tipo === "FORNECEDOR" && !supplierId
                      ? "Selecione o fornecedor primeiro"
                      : tipo === "FORNECEDOR" && availableProducts.length === 0
                        ? "Nenhum produto deste fornecedor"
                        : "Selecione..."}
                  </option>
                  {selectableProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.nome} ({p.sku})</option>
                  ))}
                </select>
              </div>

              {/* Embalagem */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-faint">Embalagem</label>
                <select
                  value={item.packagingId ?? ""}
                  onChange={(e) => updateItem(idx, { packagingId: e.target.value || null })}
                  disabled={!prod || prod.packagings.length === 0}
                  className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink disabled:opacity-50 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                  <option value="">Unidade</option>
                  {prod?.packagings.map((pk) => (
                    <option key={pk.id} value={pk.id}>{pk.nome} (×{Number(pk.fatorConversao)})</option>
                  ))}
                </select>
              </div>

              {/* Quantidade */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-faint">Qtd</label>
                <input
                  type="number"
                  min={0.001}
                  step={0.001}
                  value={item.quantidade}
                  onChange={(e) => updateItem(idx, { quantidade: Number(e.target.value) })}
                  className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink tabular-nums focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
              </div>

              {/* Custo total */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-faint">Custo total (R$)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={item.custoDisplay}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "");
                    const cents = parseInt(digits || "0", 10);
                    const num = cents / 100;
                    updateItem(idx, {
                      custoDisplay: digits
                        ? num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : "",
                      custoTotal: num,
                    });
                  }}
                  placeholder="0,00"
                  className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink tabular-nums focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
              </div>

              <button
                type="button"
                onClick={() => removeItem(idx)}
                disabled={items.length === 1}
                className="mt-5 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-danger transition-colors hover:bg-danger-soft disabled:opacity-30"
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}

        <button
          type="button"
          onClick={addItem}
          className="flex items-center gap-2 self-start rounded-full border border-dashed border-line px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-brand hover:text-brand"
        >
          <Plus size={15} /> Adicionar item
        </button>
      </div>

      {error && (
        <p className="rounded-[var(--radius)] bg-danger-soft px-4 py-2.5 text-sm font-medium text-danger">
          {error}
        </p>
      )}

      {/* Footer */}
      <div className="sticky bottom-0 flex justify-end gap-3 border-t border-line bg-canvas pb-2 pt-4">
        <button
          type="button"
          onClick={() => router.back()}
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
          Confirmar entrada
        </button>
      </div>
    </div>
  );
}
