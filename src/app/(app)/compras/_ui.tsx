"use client";

import {
  CalendarClock,
  CircleCheck,
  CircleX,
  Clock3,
  FilePenLine,
  Minus,
  Package,
  PackageCheck,
  Plus,
  Send,
  Truck,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Primitivos compartilhados do módulo de Compras.

export const fmtMoney = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const fmtQtd = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** Status do pedido de compra — ícone/cores/label únicos, usados em toda tela que referencia um PurchaseOrder. */
export const PEDIDO_STATUS: Record<string, { label: string; icon: React.ElementType; cls: string; dot: string; soft: string; text: string }> = {
  RASCUNHO:         { label: "Em elaboração",      icon: FilePenLine,   cls: "bg-surface-2 text-muted",  dot: "bg-faint",  soft: "bg-surface-2",  text: "text-muted" },
  ENVIADO:          { label: "Enviado",            icon: Send,         cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400", dot: "bg-blue-500", soft: "bg-blue-500/10", text: "text-blue-600 dark:text-blue-400" },
  AGUARDANDO:       { label: "Aguardando entrega", icon: Clock3,       cls: "bg-warn-soft text-warn",   dot: "bg-warn",   soft: "bg-warn-soft",  text: "text-warn" },
  RECEBIDO_PARCIAL: { label: "Recebido parcial",   icon: PackageCheck, cls: "bg-brand-soft text-brand", dot: "bg-brand",  soft: "bg-brand-soft", text: "text-brand" },
  RECEBIDO:         { label: "Recebido",           icon: CircleCheck,  cls: "bg-ok-soft text-ok",       dot: "bg-ok",     soft: "bg-ok-soft",    text: "text-ok" },
  CANCELADO:        { label: "Cancelado",          icon: CircleX,      cls: "bg-danger-soft text-danger", dot: "bg-danger", soft: "bg-danger-soft", text: "text-danger" },
};

export function StatusBadge({ status }: { status: string }) {
  const m = PEDIDO_STATUS[status] ?? { label: status, icon: FilePenLine, cls: "bg-surface-2 text-muted" };
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", m.cls)}>
      <Icon size={12} />
      {m.label}
    </span>
  );
}

/** Estado derivado do prazo de entrega — não é status novo, só uma leitura do `previsaoEntrega` para pedidos ainda abertos. */
export function estadoEntrega(iso: string | null): { label: string; icon: React.ElementType; cls: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  const hoje = new Date();
  const dia = (x: Date) => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86400000);
  const diff = dia(d) - dia(hoje);
  if (diff < 0) return { label: "Atrasado", icon: TriangleAlert, cls: "bg-danger-soft text-danger" };
  if (diff === 0) return { label: "Chega hoje", icon: Truck, cls: "bg-brand-soft text-brand" };
  if (diff === 1) return { label: "Previsto para amanhã", icon: CalendarClock, cls: "bg-surface-2 text-muted" };
  return null;
}

export function relDia(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const hoje = new Date();
  const dia = (x: Date) => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86400000);
  const diff = dia(hoje) - dia(d);
  if (diff === 0) return "hoje";
  if (diff === 1) return "ontem";
  if (diff < 30) return `há ${diff} dias`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function previsaoLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const hoje = new Date();
  const dia = (x: Date) => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86400000);
  const diff = dia(d) - dia(hoje);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  if (diff === -1) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Miniatura do produto — foto quando existir, senão ícone neutro. */
export function Thumb({ url, nome, size = 40 }: { url: string | null; nome?: string; size?: number }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={nome ?? ""}
        width={size}
        height={size}
        className="shrink-0 rounded-lg border border-line bg-surface object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-faint"
      style={{ width: size, height: size }}
    >
      <Package size={Math.round(size * 0.45)} />
    </span>
  );
}

/** Semáforo da reposição — ruptura / crítico / abaixo do mínimo. */
export const STATUS_REPO = {
  ruptura: { label: "Ruptura", dot: "bg-danger", text: "text-danger", soft: "bg-danger-soft" },
  critico: { label: "Crítico", dot: "bg-warn", text: "text-warn", soft: "bg-warn-soft" },
  abaixo: { label: "Abaixo do mínimo", dot: "bg-accent", text: "text-accent", soft: "bg-accent-soft" },
} as const;

export type StatusRepo = keyof typeof STATUS_REPO;

export function StatusDot({ status, comLabel = false }: { status: StatusRepo; comLabel?: boolean }) {
  const m = STATUS_REPO[status];
  if (!comLabel) return <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", m.dot)} title={m.label} />;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", m.soft, m.text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

/** Stepper touch-friendly de quantidade (unidades de compra). */
export function Stepper({
  value,
  onChange,
  disabled = false,
  min = 0,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  min?: number;
}) {
  const btn =
    "grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) disabled:opacity-35 disabled:hover:bg-surface";
  return (
    <div className={cn("flex items-center gap-1", disabled && "opacity-50")}>
      <button type="button" disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 1))} className={btn} aria-label="Diminuir">
        <Minus size={14} />
      </button>
      <input
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = parseInt(e.target.value.replace(/\D/g, ""), 10);
          onChange(Number.isNaN(v) ? min : Math.max(min, v));
        }}
        className="h-9 w-12 rounded-lg border border-line bg-surface text-center text-sm font-semibold tabular-nums text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
        aria-label="Quantidade"
      />
      <button type="button" disabled={disabled} onClick={() => onChange(value + 1)} className={btn} aria-label="Aumentar">
        <Plus size={14} />
      </button>
    </div>
  );
}

/** Barra de cobertura: quantos dias o estoque atual dura no ritmo de venda. */
export function CoberturaBar({ dias, status }: { dias: number | null; status: StatusRepo }) {
  const m = STATUS_REPO[status];
  const pct = dias == null ? 0 : Math.max(4, Math.min(100, (dias / 14) * 100));
  return (
    <div className="flex w-full items-center gap-2">
      <div className="h-1.5 w-full min-w-12 overflow-hidden rounded-full bg-surface-2">
        <div className={cn("h-full rounded-full", m.dot)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("shrink-0 text-[11px] font-medium tabular-nums", m.text)}>
        {dias == null ? "sem giro" : dias <= 0 ? "acabou" : `dura ~${dias}d`}
      </span>
    </div>
  );
}
