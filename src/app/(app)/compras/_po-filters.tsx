"use client";

import { Gift, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PEDIDO_STATUS } from "./_ui";
import type { PedidoView } from "./_pedidos";

// ── Filtros compartilhados entre Lista e Kanban ────────────────
// O estado vive no client root — trocar de visualização preserva tudo.

export type PoFiltros = {
  q: string;
  supplierId: string;
  status: string;      // "" = todos
  periodo: string;     // dias de criação: "" | "7" | "30" | "90"
  valor: string;       // "" | "ate500" | "500a2000" | "2000mais"
  ordem: string;       // "recentes" | "entrega" | "valor-desc" | "valor-asc" | "numero"
  bonificacao: boolean; // só pedidos com algum item bonificado/brinde/troca/amostra/serviço
};

export const PO_FILTROS_VAZIO: PoFiltros = {
  q: "",
  supplierId: "",
  status: "",
  periodo: "30",
  valor: "",
  ordem: "recentes",
  bonificacao: false,
};

export function filtrosAtivos(f: PoFiltros): boolean {
  return (
    f.q.trim() !== "" ||
    f.supplierId !== "" ||
    f.status !== "" ||
    f.periodo !== PO_FILTROS_VAZIO.periodo ||
    f.valor !== "" ||
    f.bonificacao
  );
}

/** Aplica filtros + ordenação — única fonte de verdade para as duas visualizações. */
export function aplicarFiltros(pedidos: PedidoView[], f: PoFiltros): PedidoView[] {
  const termo = f.q.trim().toLowerCase();
  const corte = f.periodo ? Date.now() - Number(f.periodo) * 864e5 : null;

  const out = pedidos.filter((p) => {
    if (f.supplierId && p.supplierId !== f.supplierId) return false;
    if (f.status && p.status !== f.status) return false;
    if (corte && new Date(p.createdAt).getTime() < corte) return false;
    if (f.valor === "ate500" && p.valorTotal > 500) return false;
    if (f.valor === "500a2000" && (p.valorTotal < 500 || p.valorTotal > 2000)) return false;
    if (f.valor === "2000mais" && p.valorTotal < 2000) return false;
    if (f.bonificacao && !p.items.some((i) => i.tipo !== "COMPRA")) return false;
    if (termo) {
      const alvo = `${p.numero} ${p.supplierNome} ${p.siteNome} ${p.operador ?? ""} ${p.items.map((i) => `${i.nome} ${i.sku}`).join(" ")}`.toLowerCase();
      if (!alvo.includes(termo)) return false;
    }
    return true;
  });

  out.sort((a, b) => {
    switch (f.ordem) {
      case "entrega": {
        const ta = a.previsaoEntrega ? new Date(a.previsaoEntrega).getTime() : Infinity;
        const tb = b.previsaoEntrega ? new Date(b.previsaoEntrega).getTime() : Infinity;
        return ta - tb;
      }
      case "valor-desc": return b.valorTotal - a.valorTotal;
      case "valor-asc":  return a.valorTotal - b.valorTotal;
      case "numero":     return b.numero.localeCompare(a.numero);
      default:           return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }
  });

  return out;
}

const selectCls =
  "h-9 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)";

export function PurchaseOrderFilters({
  filtros,
  onChange,
  fornecedores,
}: {
  filtros: PoFiltros;
  onChange: (f: PoFiltros) => void;
  fornecedores: { id: string; nome: string }[];
}) {
  const set = (patch: Partial<PoFiltros>) => onChange({ ...filtros, ...patch });
  const ativos = filtrosAtivos(filtros);

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      {/* Pesquisa */}
      <div className="relative min-w-44 flex-1 sm:max-w-xs">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
        <input
          value={filtros.q}
          onChange={(e) => set({ q: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Escape") set({ q: "" }); }}
          placeholder="Buscar pedido, fornecedor, produto…"
          className="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-7 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
        />
        {filtros.q && (
          <button
            type="button"
            onClick={() => set({ q: "" })}
            aria-label="Limpar busca"
            className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-faint hover:text-ink"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <select value={filtros.supplierId} onChange={(e) => set({ supplierId: e.target.value })} className={selectCls} aria-label="Fornecedor">
        <option value="">Fornecedor: todos</option>
        {fornecedores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
      </select>

      <select value={filtros.status} onChange={(e) => set({ status: e.target.value })} className={selectCls} aria-label="Status">
        <option value="">Status: todos</option>
        {Object.entries(PEDIDO_STATUS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
      </select>

      <select value={filtros.periodo} onChange={(e) => set({ periodo: e.target.value })} className={selectCls} aria-label="Período">
        <option value="">Todo período</option>
        <option value="7">Últimos 7 dias</option>
        <option value="30">Últimos 30 dias</option>
        <option value="90">Últimos 90 dias</option>
      </select>

      <select value={filtros.valor} onChange={(e) => set({ valor: e.target.value })} className={selectCls} aria-label="Valor">
        <option value="">Qualquer valor</option>
        <option value="ate500">Até R$ 500</option>
        <option value="500a2000">R$ 500 – 2.000</option>
        <option value="2000mais">Acima de R$ 2.000</option>
      </select>

      <select value={filtros.ordem} onChange={(e) => set({ ordem: e.target.value })} className={selectCls} aria-label="Ordenação">
        <option value="recentes">Mais recentes</option>
        <option value="entrega">Entrega próxima</option>
        <option value="valor-desc">Maior valor</option>
        <option value="valor-asc">Menor valor</option>
        <option value="numero">Número</option>
      </select>

      <button
        type="button"
        onClick={() => set({ bonificacao: !filtros.bonificacao })}
        aria-pressed={filtros.bonificacao}
        className={cn(
          "flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium transition-colors",
          filtros.bonificacao ? "border-violet/40 bg-violet-soft text-violet" : "border-line bg-surface text-muted hover:bg-surface-2",
        )}
      >
        <Gift size={13} /> Com bonificação
      </button>

      {ativos && (
        <button
          type="button"
          onClick={() => onChange({ ...PO_FILTROS_VAZIO, ordem: filtros.ordem })}
          className={cn(
            "flex h-9 items-center gap-1 rounded-lg border border-line px-2.5 text-sm font-medium text-muted",
            "transition-colors hover:bg-surface-2 hover:text-ink",
          )}
        >
          <X size={13} /> Limpar
        </button>
      )}
    </div>
  );
}
