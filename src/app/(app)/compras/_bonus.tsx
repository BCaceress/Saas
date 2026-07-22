"use client";

import { useMemo, useRef, useState } from "react";
import {
  Gift,
  MessageSquarePlus,
  Package,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import { fmtQtd, Thumb } from "./_ui";
import {
  COL,
  defaultPackaging,
  packagingOf,
  PurchasePackagingSelector,
  PurchaseQuantityStepper,
  type PurchaseItemProduct,
} from "./_purchase-item";
import {
  MOTIVO_BONIFICACAO_OPTIONS,
  TIPO_ITEM_LABEL,
  type MotivoBonificacao,
  type TipoItemPedido,
} from "./_types";

// ── Bonificação — produtos enviados de graça pelo fornecedor ──
// Fluxo próprio (não um checkbox no item): busca, monta uma lista à parte
// com embalagem/quantidade/motivo por item, e só entra no pedido ao
// confirmar — sempre com custo zero, sempre separada dos itens comprados.

export type BonusDraftItem = {
  id: string; // chave client-side (permite repetir o mesmo produto em pedidos futuros com tipos diferentes)
  productId: string;
  packagingId: string | null;
  qtd: number;
  motivo: MotivoBonificacao | null;
  observacao: string;
};

const inputCls =
  "h-7 rounded-lg border border-line bg-surface px-2 text-xs text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)";

const COL_MOTIVO = "w-40 shrink-0";

// ── Badge — identifica visualmente um item sem custo em qualquer lista ──

export function BonusBadge({ tipo }: { tipo: TipoItemPedido }) {
  if (tipo === "COMPRA") return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-soft px-2 py-0.5 text-[10px] font-semibold text-violet">
      <Gift size={10} /> {TIPO_ITEM_LABEL[tipo]}
    </span>
  );
}

// ── Motivo — opcional, some das listas quando vazio ───────────

export function BonusReasonSelect({
  value,
  onChange,
}: {
  value: MotivoBonificacao | null;
  onChange: (v: MotivoBonificacao | null) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) =>
        onChange((e.target.value || null) as MotivoBonificacao | null)
      }
      aria-label="Motivo da bonificação"
      className={cn(inputCls, COL_MOTIVO)}
    >
      <option value="">Motivo (opcional)</option>
      {MOTIVO_BONIFICACAO_OPTIONS.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label}
        </option>
      ))}
    </select>
  );
}

// ── Conversão embalagem → estoque, sem nada de custo ──────────

export function BonusConversionInfo({
  pkg,
  qtd,
}: {
  pkg: { nome: string; fatorConversao: number } | null;
  qtd: number;
}) {
  const fator = pkg ? pkg.fatorConversao : 1;
  const unidades = qtd * fator;
  if (unidades <= 0)
    return <p className="text-[11px] text-muted">Informe a quantidade.</p>;
  return (
    <p className="flex items-center gap-1 text-[11px] text-muted">
      <Package size={11} className="shrink-0 text-violet" />
      Entrada:{" "}
      <strong className="font-semibold text-ink">{fmtQtd(unidades)} UN</strong>
      {pkg && pkg.fatorConversao !== 1 && (
        <span className="text-faint">
          ({fmtQtd(qtd)} {pkg.nome.toLowerCase()} × {fmtQtd(pkg.fatorConversao)}
          )
        </span>
      )}
    </p>
  );
}

// ── Cabeçalho de colunas — mesmas colunas Produto/Embalagem/Qtd do
// pedido comprado; Preço/Total virem Motivo (bonificação não tem custo).

export function BonusListHeader() {
  return (
    <div className="hidden items-center gap-2 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-faint sm:flex">
      <span className="min-w-0 flex-1">Produto</span>
      <span className={COL.embalagem}>Embalagem</span>
      <span className={cn(COL.qtd, "text-center")}>Qtd</span>
      <span className={COL_MOTIVO}>Motivo</span>
      <span className={COL.remover} aria-hidden />
    </div>
  );
}

// ── Card — mesmo layout/interação do PurchaseItemCard (linha densa
// 2-linhas): só troca a coluna de preço/total por Motivo, sem custo.

export function BonusItemCard({
  product,
  value,
  onChange,
  onRemove,
}: {
  product: PurchaseItemProduct;
  value: BonusDraftItem;
  onChange: (patch: Partial<BonusDraftItem>) => void;
  onRemove: () => void;
}) {
  const pkg = packagingOf(product, value.packagingId);
  const [notaAberta, setNotaAberta] = useState(
    value.observacao.trim().length > 0,
  );

  return (
    <li
      className="rounded-xl border border-line bg-surface-2/40 px-3 py-2"
      onKeyDown={(e) => {
        const tag = (e.target as HTMLElement).tagName;
        if (
          e.key === "Delete" &&
          tag !== "INPUT" &&
          tag !== "SELECT" &&
          tag !== "TEXTAREA"
        )
          onRemove();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 basis-full items-center gap-2.5 sm:basis-0">
          <Thumb url={product.imagemUrl} nome={product.nome} size={30} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium leading-tight text-ink">
              {product.nome}
            </p>
            <p className="truncate font-mono text-[10px] text-faint">
              {product.sku}
              {product.categoria ? (
                <span className="font-sans"> · {product.categoria}</span>
              ) : null}
            </p>
          </div>
        </div>

        <PurchasePackagingSelector
          product={product}
          value={value.packagingId}
          onChange={(packagingId) => onChange({ packagingId })}
        />
        <PurchaseQuantityStepper
          value={value.qtd}
          onChange={(qtd) => onChange({ qtd })}
        />
        <BonusReasonSelect
          value={value.motivo}
          onChange={(motivo) => onChange({ motivo })}
        />

        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remover ${product.nome}`}
          className={cn(
            COL.remover,
            "grid h-7 place-items-center rounded-lg border border-line text-faint hover:bg-danger-soft hover:text-danger",
          )}
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line/60 pt-1.5">
        <BonusConversionInfo pkg={pkg} qtd={value.qtd} />
        {notaAberta ? (
          <div className="flex w-full items-center gap-1.5 sm:w-auto">
            <input
              value={value.observacao}
              onChange={(e) => onChange({ observacao: e.target.value })}
              placeholder="Observação…"
              maxLength={500}
              className={cn(inputCls, "min-w-0 flex-1 sm:w-44")}
            />
            <button
              type="button"
              onClick={() => {
                onChange({ observacao: "" });
                setNotaAberta(false);
              }}
              aria-label="Remover observação"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-faint hover:bg-surface-2 hover:text-ink"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setNotaAberta(true)}
            className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-faint transition-colors hover:text-ink"
          >
            <MessageSquarePlus size={12} /> Observação
          </button>
        )}
      </div>
    </li>
  );
}

// ── Resumo — rodapé do painel: produtos, quantidade, valor sempre 0 ──

export function BonusSummary({
  produtos,
  unidades,
}: {
  produtos: number;
  unidades: number;
}) {
  return (
    <div className="flex items-center gap-4 text-sm">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">
          Produtos
        </p>
        <p className="font-semibold tabular-nums text-ink">{produtos}</p>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">
          Quantidade
        </p>
        <p className="font-semibold tabular-nums text-ink">
          {fmtQtd(unidades)} unidades
        </p>
      </div>
    </div>
  );
}

// ── SidePanel — busca + rascunho + confirmação ────────────────

export function BonusItemSidePanel({
  open,
  onClose,
  products,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  products: (PurchaseItemProduct & { ean?: string | null })[];
  /** Confirma a lista de bonificações — o pai injeta como itens tipo BONIFICACAO no pedido. */
  onAdd: (items: BonusDraftItem[]) => void;
}) {
  const buscaRef = useRef<HTMLInputElement>(null);
  const [busca, setBusca] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [draft, setDraft] = useState<BonusDraftItem[]>([]);
  const idSeq = useRef(0);

  const prodMap = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  const resultados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return [];
    return products
      .filter((p) =>
        `${p.nome} ${p.sku} ${p.ean ?? ""}`.toLowerCase().includes(termo),
      )
      .slice(0, 8);
  }, [busca, products]);

  function addProduto(prod: PurchaseItemProduct | undefined) {
    if (!prod) return;
    const pkg = defaultPackaging(prod);
    setDraft((d) => [
      ...d,
      {
        id: `bonus-${idSeq.current++}`,
        productId: prod.id,
        packagingId: pkg?.id ?? null,
        qtd: 1,
        motivo: null,
        observacao: "",
      },
    ]);
    setBusca("");
    setHighlighted(0);
    buscaRef.current?.focus();
  }

  function patchItem(id: string, patch: Partial<BonusDraftItem>) {
    setDraft((d) => d.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function removeItem(id: string) {
    setDraft((d) => d.filter((it) => it.id !== id));
  }

  const validos = draft.filter((it) => it.qtd > 0);
  const totalUnidades = validos.reduce((acc, it) => {
    const prod = prodMap.get(it.productId);
    const pkg = prod ? packagingOf(prod, it.packagingId) : null;
    return acc + it.qtd * (pkg ? pkg.fatorConversao : 1);
  }, 0);

  function confirmar() {
    if (validos.length === 0) return;
    onAdd(validos);
    setDraft([]);
    setBusca("");
    onClose();
  }

  function fechar() {
    setDraft([]);
    setBusca("");
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={fechar}
      title="Adicionar bonificação"
      description="Produtos enviados gratuitamente pelo fornecedor. Esses itens entrarão no estoque, porém não aumentarão o valor financeiro do pedido."
      width="xl"
      footer={
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <BonusSummary produtos={validos.length} unidades={totalUnidades} />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={fechar}
                className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={validos.length === 0}
                onClick={confirmar}
                className="flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand hover:bg-brand-strong disabled:opacity-50"
              >
                <Gift size={15} /> Adicionar bonificação
              </button>
            </div>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-3 text-faint" />
          <input
            ref={buscaRef}
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setHighlighted(0);
            }}
            onKeyDown={(e) => {
              if (resultados.length === 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlighted((h) => Math.min(h + 1, resultados.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlighted((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                addProduto(resultados[highlighted] ?? resultados[0]);
              }
            }}
            placeholder="Buscar por nome, SKU, código ou código de barras…"
            className="w-full rounded-xl border border-line bg-surface py-2.5 pl-10 pr-3 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
          />
          {resultados.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-(--shadow-2)">
              {resultados.map((p, i) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => addProduto(p)}
                    onMouseEnter={() => setHighlighted(i)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors hover:bg-surface-2",
                      i === highlighted && "bg-brand-soft/50",
                    )}
                  >
                    <Thumb url={p.imagemUrl} nome={p.nome} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {p.nome}
                      </p>
                      <p className="font-mono text-[11px] text-faint">
                        {p.sku}
                      </p>
                    </div>
                    <Plus size={15} className="shrink-0 text-faint" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {draft.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line py-10 text-center">
            <Gift size={24} className="text-faint" />
            <p className="text-sm text-muted">
              Busque um produto acima para adicionar como bonificação.
            </p>
          </div>
        ) : (
          <>
            <BonusListHeader />
            <ul className="flex flex-col gap-1.5">
              {draft.map((it) => {
                const prod = prodMap.get(it.productId);
                if (!prod) return null;
                return (
                  <BonusItemCard
                    key={it.id}
                    product={prod}
                    value={it}
                    onChange={(patch) => patchItem(it.id, patch)}
                    onRemove={() => removeItem(it.id)}
                  />
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Sheet>
  );
}
