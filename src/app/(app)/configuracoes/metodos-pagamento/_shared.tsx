"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Rótulos amigáveis dos provedores de pagamento integrado. */
export const PROVIDER_LABEL: Record<string, string> = {
  MERCADO_PAGO: "Mercado Pago",
  STONE: "Stone (Pagar.me)",
  PAGSEGURO: "PagSeguro",
  SIMULADO: "Simulado",
};

export type SiteOption = { id: string; nome: string };

export type TerminalVinculado = {
  id: string;
  nome: string;
  externalId: string;
  siteId: string;
  siteNome: string;
};

/** Cabeçalho de seção: eyebrow + descrição em linguagem de operador. */
export function SectionHeader({
  title,
  description,
  badge,
  actions,
}: {
  title: string;
  description: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div>
        <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
          {title}
          {badge}
        </p>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      {actions}
    </div>
  );
}

/** Ponto de status colorido + rótulo (Conectado, Online…). */
export function StatusDot({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "danger" | "neutral";
  children: React.ReactNode;
}) {
  const dot = {
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
    neutral: "bg-faint",
  }[tone];
  const text = {
    ok: "text-ok",
    warn: "text-warn",
    danger: "text-danger",
    neutral: "text-muted",
  }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-medium", text)}>
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {children}
    </span>
  );
}

/** Opção de rádio em card — usada nos sidepanels de modo de processamento. */
export function OpcaoModo({
  selecionado,
  onSelect,
  titulo,
  descricao,
}: {
  selecionado: boolean;
  onSelect: () => void;
  titulo: string;
  descricao: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selecionado}
      onClick={onSelect}
      className={cn(
        "flex w-full cursor-pointer items-start gap-3 rounded-[var(--radius)] border p-3.5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
        selecionado ? "border-brand bg-brand-soft" : "border-line hover:bg-surface-2"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2",
          selecionado ? "border-brand" : "border-line-strong"
        )}
      >
        {selecionado && <span className="h-2 w-2 rounded-full bg-brand" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{titulo}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-muted">{descricao}</span>
      </span>
    </button>
  );
}
