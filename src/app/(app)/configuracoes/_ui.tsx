"use client";

import { CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Interruptor padrão das telas de Configurações (mesmo visual da Fidelização). */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative mt-1 h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full border-0 p-0 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-brand" : "bg-line-strong",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

/** Cartão de configuração: ícone + título + descrição, conteúdo/switch à direita ou abaixo. */
export function SettingCard({
  icon,
  iconTone = "brand",
  title,
  description,
  right,
  children,
}: {
  icon: React.ReactNode;
  iconTone?: "brand" | "accent" | "warn" | "ok" | "danger";
  title: string;
  description: React.ReactNode;
  right?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const tone = {
    brand: "bg-brand-soft text-brand",
    accent: "bg-accent-soft text-accent",
    warn: "bg-warn-soft text-warn",
    ok: "bg-ok-soft text-ok",
    danger: "bg-danger-soft text-danger",
  }[iconTone];

  return (
    <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", tone)}>
            {icon}
          </span>
          <div className="flex-1">
            <p className="font-semibold text-ink">{title}</p>
            <p className="mt-0.5 max-w-md text-sm text-muted">{description}</p>
            {children}
          </div>
        </div>
        {right}
      </div>
    </div>
  );
}

/** Campo numérico curto com unidade ao lado — número é dado, então vai em mono. */
export function CampoDias({
  id,
  value,
  onChange,
  min,
  max,
  sufixo,
  placeholder,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  min: number;
  max: number;
  sufixo: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        className="h-10 w-24 px-3 text-center font-mono text-sm"
      />
      <span className="text-sm text-muted">{sufixo}</span>
    </div>
  );
}

/** Estado do formulário no canto do card: pendente (âmbar) ou salvo (verde). */
export function SeloEstado({ dirty, salvo }: { dirty: boolean; salvo: boolean }) {
  if (dirty) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-warn-soft px-2.5 py-1 text-[12px] font-medium text-warn">
        <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden />
        Alterações não salvas
      </span>
    );
  }
  if (salvo) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-ok-soft px-2.5 py-1 text-[12px] font-medium text-ok motion-safe:animate-[fade-up_0.22s_cubic-bezier(0.16,1,0.3,1)_both]">
        <CheckCircle2 size={13} aria-hidden />
        Configurações salvas
      </span>
    );
  }
  return null;
}

/**
 * Barra de ação fixa no rodapé da tela de configuração. Fica sempre à vista e
 * só liga quando há o que salvar — botão que some tira do operador a
 * referência de onde confirmar.
 */
export function BarraAcoes({
  estado,
  tomAlerta,
  children,
}: {
  estado: string;
  tomAlerta?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-line-strong bg-surface/95 px-4 py-3 shadow-[var(--shadow-float)] backdrop-blur">
      <p className={cn("text-sm", tomAlerta ? "text-danger" : "text-muted")}>{estado}</p>
      {children}
    </div>
  );
}
