"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PEDIDO_STATUS } from "../cotacoes/_ui";
import {
  filtrosAtivos,
  PO_FILTROS_VAZIO,
  PO_STATUS_ABERTOS,
  type PoFiltros,
  type PoRecebimento,
} from "./_query";

// ── Filtros de Pedidos ─────────────────────────────────────────
//
// Componente de apresentação: o estado é a URL. Filtrar agora acontece no
// banco, então quem manda no recorte precisa ser algo que o servidor leia — e
// de quebra o filtro passa a ser compartilhável e sobrevive ao F5.
//
// Status e recebimento são DOIS seletores porque são duas perguntas: "em que
// pé está o pedido?" e "quanto já chegou?". Misturá-los num só criaria
// pseudo-status ("aguardando recebimento", "em conferência") que não existem
// no ciclo do pedido — esses pertencem ao recebimento, que é outra entidade.

const RECEBIMENTOS: { value: PoRecebimento; label: string }[] = [
  { value: "", label: "Recebimento: todos" },
  { value: "sem", label: "Sem recebimento" },
  { value: "parcial", label: "Parcial" },
  { value: "recebido", label: "Recebido" },
];

const selectCls =
  "h-9 rounded-sm border border-line bg-surface px-2.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)";

export function PurchaseOrderFilters({
  filtros,
  onChange,
  fornecedores,
  pendente,
}: {
  filtros: PoFiltros;
  onChange: (f: PoFiltros) => void;
  fornecedores: { id: string; nome: string }[];
  /** Navegação em voo — o campo de busca mostra que está trabalhando. */
  pendente?: boolean;
}) {
  // A busca é local enquanto se digita e só vira URL depois da pausa: uma
  // navegação por tecla faria o servidor consultar a cada letra.
  const [texto, setTexto] = useState(filtros.q);

  // Ajuste de estado durante o render (não em efeito): quando o termo chega
  // de fora — voltar no histórico, clicar em "Limpar" — o campo acompanha.
  // Em efeito, isto custaria um render descartado a cada navegação.
  const [qAnterior, setQAnterior] = useState(filtros.q);
  if (filtros.q !== qAnterior) {
    setQAnterior(filtros.q);
    setTexto(filtros.q);
  }

  useEffect(() => {
    if (texto === filtros.q) return;
    const t = setTimeout(() => onChange({ ...filtros, q: texto, pagina: 1 }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  // Trocar qualquer recorte volta para a primeira página: continuar na página 4
  // de um resultado que agora tem duas é a tela mostrando vazio sem motivo.
  const set = (patch: Partial<PoFiltros>) => onChange({ ...filtros, ...patch, pagina: 1 });
  const ativos = filtrosAtivos(filtros);

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <div className="relative min-w-44 flex-1 sm:max-w-xs">
        <Search
          size={14}
          className={cn(
            "absolute left-2.5 top-1/2 -translate-y-1/2 transition-colors",
            pendente ? "animate-pulse text-brand" : "text-faint",
          )}
        />
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setTexto("");
            if (e.key === "Enter") onChange({ ...filtros, q: texto, pagina: 1 });
          }}
          placeholder="Buscar pedido, fornecedor, produto…"
          className="h-9 w-full rounded-sm border border-line bg-surface pl-8 pr-7 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
        />
        {texto && (
          <button
            type="button"
            onClick={() => setTexto("")}
            aria-label="Limpar busca"
            className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-faint hover:text-ink"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <select
        value={filtros.supplierId}
        onChange={(e) => set({ supplierId: e.target.value })}
        className={selectCls}
        aria-label="Fornecedor"
      >
        <option value="">Fornecedor: todos</option>
        {fornecedores.map((s) => (
          <option key={s.id} value={s.id}>{s.nome}</option>
        ))}
      </select>

      {/* "Em aberto" primeiro E selecionado por padrão: o seletor mostra o
          recorte em vigor, então nada some sem o operador ver por quê. */}
      <select
        value={filtros.status}
        onChange={(e) => set({ status: e.target.value })}
        className={cn(
          selectCls,
          filtros.status === PO_STATUS_ABERTOS && "border-brand/40 bg-brand-soft text-brand",
        )}
        aria-label="Status do pedido"
      >
        <option value={PO_STATUS_ABERTOS}>Em aberto</option>
        <option value="">Status: todos</option>
        {/* Exatamente os seis status do ciclo do pedido — PEDIDO_STATUS é a
            fonte única, então um status novo aparece aqui sozinho. */}
        {Object.entries(PEDIDO_STATUS).map(([k, m]) => (
          <option key={k} value={k}>{m.label}</option>
        ))}
      </select>

      <select
        value={filtros.recebimento}
        onChange={(e) => set({ recebimento: e.target.value as PoRecebimento })}
        className={cn(selectCls, filtros.recebimento && "border-accent/40 bg-accent-soft text-accent")}
        aria-label="Recebimento"
      >
        {RECEBIMENTOS.map((r) => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>

      <select
        value={filtros.periodo}
        onChange={(e) => set({ periodo: e.target.value })}
        className={selectCls}
        aria-label="Período"
      >
        <option value="">Todo período</option>
        <option value="7">Últimos 7 dias</option>
        <option value="30">Últimos 30 dias</option>
        <option value="90">Últimos 90 dias</option>
      </select>

      <select
        value={filtros.ordem}
        onChange={(e) => set({ ordem: e.target.value as PoFiltros["ordem"] })}
        className={selectCls}
        aria-label="Ordenação"
      >
        <option value="recentes">Mais recentes</option>
        <option value="entrega">Entrega próxima</option>
        <option value="valor-desc">Maior valor</option>
        <option value="valor-asc">Menor valor</option>
        <option value="numero">Número</option>
      </select>

      {ativos && (
        <button
          type="button"
          onClick={() => onChange({ ...PO_FILTROS_VAZIO, ordem: filtros.ordem })}
          className="flex h-9 items-center gap-1 rounded-sm border border-line px-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <X size={13} /> Limpar
        </button>
      )}
    </div>
  );
}
