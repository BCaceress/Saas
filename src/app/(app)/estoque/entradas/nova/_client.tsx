"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Package } from "lucide-react";
import { registrarEntradaAction } from "../../actions";
import { cn } from "@/lib/utils";

type Product = {
  id: string;
  nome: string;
  sku: string;
  imagemUrl: string | null;
  packagings: { id: string; nome: string; fatorConversao: unknown; isCompraDefault: boolean }[];
  suppliers: { supplierId: string }[];
  brand: { nome: string } | null;
};

type Supplier = { id: string; razaoSocial: string; nomeFantasia: string | null };
type Site = { id: string; nome: string; tipo: string };

export type Item = {
  productId: string;
  quantidade: number;
  custoTotal: number;
  custoDisplay: string;
  packagingId: string | null;
};

const itemVazio = (): Item => ({
  productId: "",
  quantidade: 1,
  custoTotal: 0,
  custoDisplay: "",
  packagingId: null,
});

/** Converte texto digitado em centavos → { display pt-BR, total }. */
function parseCusto(raw: string): { custoDisplay: string; custoTotal: number } {
  const digits = raw.replace(/\D/g, "");
  const num = parseInt(digits || "0", 10) / 100;
  return {
    custoDisplay: digits
      ? num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "",
    custoTotal: num,
  };
}

export function NovaEntradaForm({
  products,
  suppliers,
  sites,
  embedded = false,
  onDone,
  initialItems,
}: {
  products: Product[];
  suppliers: Supplier[];
  sites: Site[];
  /** Quando usado dentro de um sidepanel: não navega, chama onDone + refresh. */
  embedded?: boolean;
  onDone?: () => void;
  /** Itens pré-carregados (ex: reposição a partir dos saldos). */
  initialItems?: Item[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [tipo, setTipo] = useState<"MANUAL" | "FORNECEDOR">("MANUAL");
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [supplierId, setSupplierId] = useState("");
  const [numeroNota, setNumeroNota] = useState("");
  const [observacao, setObservacao] = useState("");
  const [items, setItems] = useState<Item[]>(
    initialItems && initialItems.length > 0 ? initialItems : [],
  );
  const [draft, setDraft] = useState<Item>(itemVazio);

  function addDraft() {
    if (!draft.productId || draft.quantidade <= 0) return;
    setItems((prev) => [...prev, draft]);
    setDraft(itemVazio());
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
    setDraft(itemVazio());
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
        if (embedded) {
          router.refresh();
          onDone?.();
        } else {
          router.push("/estoque/entradas");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao registrar.");
      }
    });
  }

  return (
    <div className="flex h-full flex-col">
     <div className="flex flex-1 flex-col gap-5">
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

      {/* Composer — escolhe um item e adiciona à lista abaixo */}
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-faint">Adicionar item</p>
        {(() => {
          const draftProd = products.find((p) => p.id === draft.productId);
          const usedIds = new Set(items.map((i) => i.productId).filter(Boolean));
          const selectableProducts = availableProducts.filter(
            (p) => !usedIds.has(p.id) || p.id === draft.productId,
          );
          const bloqueado = tipo === "FORNECEDOR" && !supplierId;
          return (
            <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-faint">Produto</label>
                <select
                  value={draft.productId}
                  onChange={(e) => {
                    const p = products.find((x) => x.id === e.target.value);
                    const padrao = p?.packagings.find((pk) => pk.isCompraDefault);
                    setDraft({ ...draft, productId: e.target.value, packagingId: padrao?.id ?? null });
                  }}
                  disabled={bloqueado}
                  className="w-full rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink disabled:opacity-50 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                  <option value="">
                    {bloqueado
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

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                {/* Embalagem */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold text-faint">Embalagem</label>
                  <select
                    value={draft.packagingId ?? ""}
                    onChange={(e) => setDraft({ ...draft, packagingId: e.target.value || null })}
                    disabled={!draftProd || draftProd.packagings.length === 0}
                    className="w-full rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink disabled:opacity-50 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    <option value="">Unidade</option>
                    {draftProd?.packagings.map((pk) => (
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
                    value={draft.quantidade}
                    onChange={(e) => setDraft({ ...draft, quantidade: Number(e.target.value) })}
                    className="w-full rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink tabular-nums focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </div>

                {/* Custo total */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold text-faint">Custo total (R$)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={draft.custoDisplay}
                    onChange={(e) => setDraft({ ...draft, ...parseCusto(e.target.value) })}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addDraft())}
                    placeholder="0,00"
                    className="w-full rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink tabular-nums focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </div>

                {/* Adicionar — ao lado do custo */}
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={addDraft}
                    disabled={!draft.productId || draft.quantidade <= 0}
                    title="Adicionar à lista"
                    className="flex h-[42px] w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-brand px-4 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-40 sm:w-auto"
                  >
                    <Plus size={16} /> <span className="sm:hidden">Adicionar à lista</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Lista de itens adicionados */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-faint">Itens</p>
          {items.length > 0 && (
            <span className="text-xs tabular-nums text-faint">
              {items.length} {items.length === 1 ? "item" : "itens"}
            </span>
          )}
        </div>

        {items.length === 0 ? (
          <p className="rounded-[var(--radius-lg)] border border-dashed border-line px-4 py-6 text-center text-sm text-faint">
            Nenhum item ainda. Adicione um produto acima.
          </p>
        ) : (
          items.map((item, idx) => {
            const prod = products.find((p) => p.id === item.productId);
            const pk = prod?.packagings.find((p) => p.id === item.packagingId);
            const desc = `${prod?.nome ?? "Produto"} · ${prod?.sku ?? ""}${pk ? ` · ${pk.nome} (×${Number(pk.fatorConversao)})` : " · Unidade"}`;
            return (
              <div
                key={idx}
                className="flex items-center gap-2.5 rounded-[var(--radius-lg)] border border-line bg-surface px-3 py-2"
              >
                {/* Imagem do produto */}
                <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[var(--radius)] border border-line bg-surface-2">
                  {prod?.imagemUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={prod.imagemUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Package size={16} className="text-faint" />
                  )}
                </span>

                {/* Nome + detalhe (trunca, hover mostra tudo) */}
                <div className="min-w-0 flex-1" title={desc}>
                  <p className="truncate text-sm font-medium text-ink">{prod?.nome ?? "Produto"}</p>
                  <p className="truncate font-mono text-[11px] text-faint">
                    {prod?.sku}
                    {pk ? ` · ${pk.nome}` : " · Unidade"}
                  </p>
                </div>

                {/* Qtd */}
                <input
                  type="number"
                  min={0.001}
                  step={0.001}
                  value={item.quantidade}
                  onChange={(e) => updateItem(idx, { quantidade: Number(e.target.value) })}
                  title="Quantidade"
                  className="w-16 shrink-0 rounded-[var(--radius)] border border-line bg-surface px-2 py-1.5 text-right text-sm text-ink tabular-nums focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />

                {/* Custo total */}
                <input
                  type="text"
                  inputMode="numeric"
                  value={item.custoDisplay}
                  onChange={(e) => updateItem(idx, parseCusto(e.target.value))}
                  placeholder="0,00"
                  title="Custo total (R$)"
                  className="w-20 shrink-0 rounded-[var(--radius)] border border-line bg-surface px-2 py-1.5 text-right text-sm text-ink tabular-nums focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />

                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  aria-label="Remover item"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-danger transition-colors hover:bg-danger-soft"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {error && (
        <p className="rounded-[var(--radius)] bg-danger-soft px-4 py-2.5 text-sm font-medium text-danger">
          {error}
        </p>
      )}
     </div>

      {/* Footer — fixo abaixo */}
      <div className="sticky bottom-0 z-10 mt-4 flex justify-end gap-3 rounded-[var(--radius-lg)] border border-line bg-surface-2 px-4 py-3">
        <button
          type="button"
          onClick={() => (embedded ? onDone?.() : router.back())}
          className="rounded-full border border-line-strong px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-surface"
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
