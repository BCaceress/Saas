"use client";

import { Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtQtd, SupplierAvatar } from "../_ui";
import { fornecedorEfetivo, type Linha, type Sel, type SubgrupoFornecedor } from "./_shared";
import { ProductSuggestionCard } from "./_product-card";

// ── Grupo de fornecedor — o elemento principal de organização ──
// Cabeçalho com prazo médio e seleção do bloco; rodapé (SupplierSummary)
// resume o pedido que será criado para esse fornecedor.

export function SupplierGroup({
  grupo,
  sel,
  setItem,
  onHistorico,
  totaisFornecedor,
  onCriarPedido,
  criando,
}: {
  grupo: SubgrupoFornecedor;
  sel: Record<string, Sel>;
  setItem: (productId: string, patch: Partial<Sel>) => void;
  onHistorico: (l: Linha) => void;
  /** Totais de TODOS os itens selecionados deste fornecedor (a mesma empresa pode aparecer em mais de um grupo de prioridade). */
  totaisFornecedor: { produtos: number; unidades: number; total: number } | null;
  onCriarPedido: ((supplierId: string) => void) | null;
  criando: boolean;
}) {
  const semFornecedor = grupo.supplierId === null;
  const marcaveis = semFornecedor ? [] : grupo.itens;
  const marcados = marcaveis.filter((l) => sel[l.productId]?.on).length;
  const todos = marcaveis.length > 0 && marcados === marcaveis.length;

  // Subtotal só do que está visível neste bloco (selecionado)
  const subtotal = grupo.itens.reduce((acc, l) => {
    const s = sel[l.productId];
    if (!s?.on || s.qtd <= 0) return acc;
    const eff = fornecedorEfetivo(l, s.supplierId);
    return acc + s.qtd * (eff.custo ?? 0);
  }, 0);

  const toggleTodos = (on: boolean) => {
    for (const l of marcaveis) setItem(l.productId, { on });
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-(--shadow-1)">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-2/50 px-4 py-2.5 sm:px-5">
        {!semFornecedor && (
          <input
            type="checkbox"
            checked={todos}
            onChange={(e) => toggleTodos(e.target.checked)}
            className="h-4.5 w-4.5 accent-brand"
            aria-label={`Selecionar todos os produtos de ${grupo.nome}`}
          />
        )}
        <SupplierAvatar nome={grupo.nome} logoUrl={grupo.logoUrl} size={30} />
        <div className="min-w-0 flex-1">
          <p className={cn("truncate font-display text-sm font-bold", semFornecedor ? "text-warn" : "text-ink")}>{grupo.nome}</p>
          <p className="text-xs text-muted">
            {grupo.itens.length} {grupo.itens.length === 1 ? "produto" : "produtos"}
            {grupo.leadTime != null && (
              <>
                {" "}
                · entrega média ~{grupo.leadTime} {grupo.leadTime === 1 ? "dia" : "dias"}
              </>
            )}
          </p>
        </div>
        {subtotal > 0 && <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">{fmtMoney(subtotal)}</p>}
      </header>

      <ul className="divide-y divide-line">
        {grupo.itens.map((l) => (
          <ProductSuggestionCard key={l.productId} linha={l} sel={sel[l.productId]} setItem={setItem} onHistorico={onHistorico} />
        ))}
      </ul>

      {!semFornecedor && totaisFornecedor && onCriarPedido && (
        <SupplierSummary
          nome={grupo.nome}
          totais={totaisFornecedor}
          criando={criando}
          onCriar={() => onCriarPedido(grupo.supplierId!)}
        />
      )}
    </section>
  );
}

export function SupplierSummary({
  nome,
  totais,
  criando,
  onCriar,
}: {
  nome: string;
  totais: { produtos: number; unidades: number; total: number };
  criando: boolean;
  onCriar: () => void;
}) {
  const vazio = totais.produtos === 0;
  return (
    <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line bg-surface-2/40 px-4 py-3 sm:px-5">
      <p className="min-w-0 text-xs text-muted">
        {vazio ? (
          "Nenhum produto selecionado deste fornecedor."
        ) : (
          <>
            <span className="font-semibold text-ink">{totais.produtos}</span> {totais.produtos === 1 ? "produto" : "produtos"} ·{" "}
            <span className="font-semibold tabular-nums text-ink">{fmtQtd(totais.unidades)}</span> unidades ·{" "}
            <span className="font-semibold tabular-nums text-ink">{fmtMoney(totais.total)}</span>
          </>
        )}
      </p>
      <button
        type="button"
        disabled={vazio || criando}
        onClick={onCriar}
        className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-45 disabled:hover:border-line disabled:hover:text-ink"
      >
        {criando ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
        Criar pedido — {nome}
      </button>
    </footer>
  );
}
