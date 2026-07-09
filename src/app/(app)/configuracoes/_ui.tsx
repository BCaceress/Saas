"use client";

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
