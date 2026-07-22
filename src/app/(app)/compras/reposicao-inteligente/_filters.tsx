"use client";

import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Filtros da revisão — busca + fornecedor ───────────────────
// Filtram só o que está visível; a seleção (e o resumo) não muda.

export function ReplenishmentFilters({
  busca,
  onBusca,
  fornecedorId,
  onFornecedor,
  fornecedores,
}: {
  busca: string;
  onBusca: (v: string) => void;
  fornecedorId: string | null;
  onFornecedor: (v: string | null) => void;
  fornecedores: { id: string; nome: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative min-w-0 flex-1 sm:max-w-xs">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          type="search"
          value={busca}
          onChange={(e) => onBusca(e.target.value)}
          placeholder="Buscar produto, SKU ou marca"
          className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
          aria-label="Buscar produto"
        />
      </label>
      <select
        value={fornecedorId ?? ""}
        onChange={(e) => onFornecedor(e.target.value || null)}
        className={cn(
          "h-10 max-w-56 rounded-xl border border-line bg-surface px-3 text-sm focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
          fornecedorId ? "text-ink" : "text-muted",
        )}
        aria-label="Filtrar por fornecedor"
      >
        <option value="">Todos os fornecedores</option>
        {fornecedores.map((f) => (
          <option key={f.id} value={f.id}>
            {f.nome}
          </option>
        ))}
      </select>
      {(busca || fornecedorId) && (
        <button
          type="button"
          onClick={() => {
            onBusca("");
            onFornecedor(null);
          }}
          className="flex h-10 items-center gap-1 rounded-xl px-2.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <X size={13} /> Limpar
        </button>
      )}
    </div>
  );
}
