"use client";

import { useMemo, useState } from "react";
import {
  Truck,
  ClipboardList,
  ArrowLeftRight,
  SlidersHorizontal,
  Undo2,
  PackagePlus,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney, PEDIDO_STATUS } from "./_ui";

type Origem = "COMPRA" | "MANUAL" | "TRANSFERENCIA" | "AJUSTE" | "DEVOLUCAO_CLIENTE" | "PEDIDO";

export type Evento = {
  id: string;
  origem: Origem;
  titulo: string;
  subtitulo: string | null;
  qtdItens: number | null;
  detalhe: string | null;
  valor: number | null;
  data: string;
  registradoPor: string | null;
  pedidoCriadoEm: string | null;
  pedidoEnviadoEm: string | null;
  statusPedido: string | null;
};

const fmtHora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const fmtDataHora = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " às " + fmtHora(iso);

export const ORIGEM_ENTRADA: Record<Origem, { label: string; icon: React.ElementType; cls: string }> = {
  COMPRA:            { label: "Compra",         icon: Truck,             cls: "bg-brand-soft text-brand" },
  MANUAL:            { label: "Entrada manual", icon: ClipboardList,     cls: "bg-surface-2 text-muted" },
  TRANSFERENCIA:     { label: "Transferência",  icon: ArrowLeftRight,    cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  AJUSTE:            { label: "Ajuste",         icon: SlidersHorizontal, cls: "bg-accent-soft text-accent" },
  DEVOLUCAO_CLIENTE: { label: "Devolução",      icon: Undo2,             cls: "bg-ok-soft text-ok" },
  PEDIDO:            { label: "Pedido",         icon: ClipboardList,     cls: "bg-surface-2 text-muted" },
};

/** Todo evento do extrato já é uma entrada consumada — o rótulo confirma qual ação a gerou. */
export const ORIGEM_STATUS: Record<Origem, string> = {
  COMPRA: "Recebido",
  MANUAL: "Registrada",
  TRANSFERENCIA: "Recebida",
  AJUSTE: "Registrado",
  DEVOLUCAO_CLIENTE: "Registrada",
  PEDIDO: "Atualizado",
};

/** Ícone/cor/label do evento — pedidos ainda não recebidos usam o status real do PurchaseOrder (mesma paleta de Compras). */
export function eventoMeta(e: Evento): { label: string; icon: React.ElementType; cls: string } {
  if (e.origem === "PEDIDO" && e.statusPedido && PEDIDO_STATUS[e.statusPedido]) return PEDIDO_STATUS[e.statusPedido];
  return ORIGEM_ENTRADA[e.origem];
}

export function eventoStatusLabel(e: Evento): string {
  if (e.origem === "PEDIDO" && e.statusPedido && PEDIDO_STATUS[e.statusPedido]) return PEDIDO_STATUS[e.statusPedido].label;
  return ORIGEM_STATUS[e.origem];
}

function diaLabel(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const dia = (x: Date) => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86400000);
  const diff = dia(hoje) - dia(d);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

const FILTROS: { key: Origem | "todos"; label: string }[] = [
  { key: "todos", label: "Tudo" },
  { key: "COMPRA", label: "Compras" },
  { key: "PEDIDO", label: "Pedidos" },
  { key: "TRANSFERENCIA", label: "Transferências" },
  { key: "AJUSTE", label: "Ajustes" },
  { key: "DEVOLUCAO_CLIENTE", label: "Devoluções" },
  { key: "MANUAL", label: "Manuais" },
];

export function ExtratoEntradas({ eventos }: { eventos: Evento[] }) {
  const [filtro, setFiltro] = useState<Origem | "todos">("todos");

  const filtrados = useMemo(
    () => (filtro === "todos" ? eventos : eventos.filter((e) => e.origem === filtro)),
    [eventos, filtro],
  );

  // Agrupa por dia, preservando a ordem (já vem desc por data).
  const grupos = useMemo(() => {
    const map = new Map<string, Evento[]>();
    for (const e of filtrados) {
      const k = diaLabel(e.data);
      const arr = map.get(k) ?? [];
      arr.push(e);
      map.set(k, arr);
    }
    return [...map.entries()];
  }, [filtrados]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: eventos.length };
    for (const e of eventos) c[e.origem] = (c[e.origem] ?? 0) + 1;
    return c;
  }, [eventos]);

  return (
    <div className="flex flex-col gap-4">
      {/* Filtros por origem */}
      <div className="flex flex-wrap gap-1.5">
        {FILTROS.map((f) => {
          const total = f.key === "todos" ? counts.todos : (counts[f.key] ?? 0);
          if (f.key !== "todos" && total === 0) return null;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFiltro(f.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                filtro === f.key ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:bg-surface-2",
              )}
            >
              {f.label}
              <span className={cn("rounded-full px-1.5 py-px text-[10px] tabular-nums", filtro === f.key ? "bg-brand/15 text-brand" : "bg-surface-2 text-faint")}>
                {total}
              </span>
            </button>
          );
        })}
      </div>

      {filtrados.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line bg-surface py-16 text-center">
          <PackagePlus size={32} className="text-faint" />
          <p className="text-sm font-medium text-muted">Nenhuma entrada neste filtro.</p>
        </div>
      ) : (
        /* Timeline: trilho contínuo, um nó por evento, cabeçalho por dia */
        <div className="relative flex flex-col gap-6 pl-5 before:absolute before:bottom-2 before:left-2.25 before:top-2 before:w-px before:bg-line sm:pl-6 sm:before:left-2.75">
          {grupos.map(([dia, lista]) => (
            <div key={dia} className="flex flex-col gap-2.5">
              <div className="relative">
                <span className="absolute -left-5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-canvas bg-faint sm:-left-6 sm:h-3 sm:w-3" />
                <p className="text-xs font-semibold uppercase tracking-wide text-faint">{dia}</p>
              </div>
              <div className="flex flex-col gap-2">
                {lista.map((e) => {
                  const meta = eventoMeta(e);
                  const Icon = meta.icon;
                  return (
                    <div key={e.id} className="relative flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-(--shadow-1)">
                      <span className="absolute left-[-24.5px] top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-line-strong sm:left-[-28.5px]" />
                      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", meta.cls)}>
                        <Icon size={17} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-ink">{e.titulo}</span>
                          <span className={cn("shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold", meta.cls)}>{meta.label}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-muted">
                          {e.subtitulo && <span>{e.subtitulo}</span>}
                          {e.qtdItens != null && <span>{e.qtdItens} {e.qtdItens === 1 ? "item" : "itens"}</span>}
                          {e.detalhe && <span className="font-medium tabular-nums text-ok">{e.detalhe}</span>}
                          {e.registradoPor && (
                            <span className="flex items-center gap-1 text-faint">
                              <User size={11} /> {e.registradoPor}
                            </span>
                          )}
                        </div>
                        {e.origem === "COMPRA" && e.pedidoCriadoEm && (
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-faint">
                            <span>Solicitado {fmtDataHora(e.pedidoCriadoEm)}</span>
                            {e.pedidoEnviadoEm && <span>· Enviado {fmtDataHora(e.pedidoEnviadoEm)}</span>}
                            <span>· Recebido {fmtDataHora(e.data)}</span>
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        {e.valor != null && <p className="font-medium tabular-nums text-ink">{fmtMoney(e.valor)}</p>}
                        <p className="text-[11px] tabular-nums text-faint">{fmtHora(e.data)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
