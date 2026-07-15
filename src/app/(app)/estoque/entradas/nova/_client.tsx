"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Package, Info, Search, X } from "lucide-react";
import { registrarEntradaAction } from "../../actions";
import { cn } from "@/lib/utils";

type Product = {
  id: string;
  nome: string;
  sku: string;
  ean: string | null;
  imagemUrl: string | null;
  packagings: { id: string; nome: string; fatorConversao: unknown; isCompraDefault: boolean }[];
  brand: { nome: string } | null;
};

type Site = { id: string; nome: string; tipo: string };

export type Motivo = "COMPRA_SEM_PEDIDO" | "BONIFICACAO" | "ESTOQUE_INICIAL";

export const MOTIVO_OPTIONS: { value: Motivo; label: string }[] = [
  { value: "COMPRA_SEM_PEDIDO", label: "Entrada manual" },
  { value: "BONIFICACAO", label: "Bonificação" },
  { value: "ESTOQUE_INICIAL", label: "Estoque inicial" },
];

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
  motivo,
  products,
  sites,
  embedded = false,
  onDone,
  initialItems,
}: {
  /** Motivo da entrada — definido pela ação escolhida no menu Registrar, não editável aqui. */
  motivo: Motivo;
  products: Product[];
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

  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [numeroNota, setNumeroNota] = useState("");
  const [observacao, setObservacao] = useState("");
  const [items, setItems] = useState<Item[]>(
    initialItems && initialItems.length > 0 ? initialItems : [],
  );
  const [draft, setDraft] = useState<Item>(itemVazio);
  const [busca, setBusca] = useState("");
  const [buscaAberta, setBuscaAberta] = useState(false);

  function selecionarProduto(p: Product) {
    const padrao = p.packagings.find((pk) => pk.isCompraDefault);
    setDraft({ ...draft, productId: p.id, packagingId: padrao?.id ?? null });
    setBusca("");
    setBuscaAberta(false);
  }

  function trocarProduto() {
    setDraft({ ...itemVazio() });
    setBusca("");
    setBuscaAberta(true);
  }

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

  function submit() {
    setError(null);
    const valid = items.filter((i) => i.productId && i.quantidade > 0);
    if (valid.length === 0) { setError("Adicione ao menos um item."); return; }
    if (!siteId) { setError("Selecione o local."); return; }

    startTransition(async () => {
      try {
        await registrarEntradaAction({
          siteId,
          motivo,
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

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-faint">Nº do documento (opcional)</label>
          <input
            value={numeroNota}
            onChange={(e) => setNumeroNota(e.target.value)}
            placeholder="Ex: 001234"
            className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
        </div>

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

      {motivo === "ESTOQUE_INICIAL" && (
        <p className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-line bg-surface-2 px-3.5 py-2.5 text-xs text-muted">
          <Info size={14} className="mt-0.5 shrink-0 text-faint" />
          Utilize esta operação para informar os saldos existentes na implantação do estoque.
        </p>
      )}

      {/* Composer — escolhe um item e adiciona à lista abaixo */}
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-faint">Adicionar item</p>
        {(() => {
          const semCusto = motivo === "BONIFICACAO";
          const draftProd = products.find((p) => p.id === draft.productId);
          const usedIds = new Set(items.map((i) => i.productId).filter(Boolean));
          const selectableProducts = products.filter((p) => !usedIds.has(p.id));
          const termo = busca.trim().toLowerCase();
          const resultados = termo
            ? selectableProducts.filter((p) =>
                `${p.nome} ${p.sku} ${p.ean ?? ""} ${p.brand?.nome ?? ""}`.toLowerCase().includes(termo),
              )
            : selectableProducts;

          return (
            <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-faint">Produto</label>
                {draftProd ? (
                  <div className="flex items-center gap-2.5 rounded-[var(--radius)] border border-brand/40 bg-brand-soft/40 px-3 py-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-sm)] border border-line bg-surface">
                      {draftProd.imagemUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={draftProd.imagemUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Package size={14} className="text-faint" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{draftProd.nome}</p>
                      <p className="truncate font-mono text-[11px] text-faint">{draftProd.sku}</p>
                    </div>
                    <button
                      type="button"
                      onClick={trocarProduto}
                      className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold text-brand transition-colors hover:bg-brand-soft"
                    >
                      Trocar
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                    <input
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      onFocus={() => setBuscaAberta(true)}
                      onBlur={() => setTimeout(() => setBuscaAberta(false), 120)}
                      placeholder="Buscar produto por nome, SKU ou código de barras..."
                      className="w-full rounded-[var(--radius)] border border-line bg-surface py-2 pl-8 pr-8 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    />
                    {busca && (
                      <button
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); setBusca(""); }}
                        aria-label="Limpar busca"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint hover:text-ink"
                      >
                        <X size={14} />
                      </button>
                    )}
                    {buscaAberta && (
                      <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-[var(--radius-lg)] border border-line bg-surface shadow-(--shadow-2)">
                        {resultados.length === 0 ? (
                          <p className="px-3.5 py-3 text-center text-xs text-faint">Nenhum produto encontrado.</p>
                        ) : (
                          resultados.slice(0, 30).map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onMouseDown={(e) => { e.preventDefault(); selecionarProduto(p); }}
                              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-surface-2"
                            >
                              <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-sm)] border border-line bg-surface-2">
                                {p.imagemUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={p.imagemUrl} alt="" className="h-full w-full object-cover" />
                                ) : (
                                  <Package size={14} className="text-faint" />
                                )}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm text-ink">{p.nome}</span>
                                <span className="block truncate font-mono text-[11px] text-faint">
                                  {p.sku}{p.ean ? ` · ${p.ean}` : ""}
                                </span>
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {draftProd && (
              <div className={cn("grid grid-cols-1 gap-3", semCusto ? "sm:grid-cols-[1fr_1fr_auto]" : "sm:grid-cols-[1fr_1fr_1fr_auto]")}>
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
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addDraft())}
                    className="w-full rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink tabular-nums focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </div>

                {/* Custo total — não se aplica à bonificação */}
                {!semCusto && (
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
                )}

                {/* Adicionar */}
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
              )}
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
            const semCusto = motivo === "BONIFICACAO";
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

                {/* Custo total — não se aplica à bonificação */}
                {!semCusto && (
                  <input
                    type="text"
                    inputMode="numeric"
                    value={item.custoDisplay}
                    onChange={(e) => updateItem(idx, parseCusto(e.target.value))}
                    placeholder="0,00"
                    title="Custo total (R$)"
                    className="w-20 shrink-0 rounded-[var(--radius)] border border-line bg-surface px-2 py-1.5 text-right text-sm text-ink tabular-nums focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                )}

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
      <div className="sticky bottom-0 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-line bg-surface-2 px-4 py-3">
        {items.length > 0 ? (
          <p className="text-xs font-medium text-muted">
            {items.length} {items.length === 1 ? "produto" : "produtos"} ·{" "}
            {items.reduce((acc, i) => acc + i.quantidade, 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}{" "}
            unidades
            {items.some((i) => i.custoTotal > 0) &&
              ` · ${items.reduce((acc, i) => acc + i.custoTotal, 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`}
          </p>
        ) : (
          <span />
        )}
        <div className="flex gap-3">
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
            disabled={pending || items.length === 0}
            className="flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-60"
          >
            {pending && <Loader2 size={14} className="animate-spin" />}
            Confirmar entrada
          </button>
        </div>
      </div>
    </div>
  );
}
