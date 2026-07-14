"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Switch — liga/desliga de configuração (substitui checkbox nesses casos).
 * Acessível (role="switch"), estado `busy` para salvamento automático
 * (pulsa e bloqueia até a resposta do servidor).
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  busy,
  className,
  ...props
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-[42px] shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        checked ? "bg-brand" : "bg-line-strong",
        (disabled || busy) && "cursor-not-allowed opacity-60",
        className
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
          checked ? "translate-x-[20px]" : "translate-x-[2px]",
          busy && "animate-pulse"
        )}
      />
    </button>
  );
}
