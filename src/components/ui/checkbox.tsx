"use client";

import * as React from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Checkbox redondo — mesma pastilha do medidor de saldo, marca cheia quando
 * ligado. O input nativo continua lá (foco, teclado, leitor de tela); só a
 * pintura é nossa (`appearance-none`), porque o desenho nativo do navegador
 * ignora `border-radius`.
 */
export function Checkbox({
  checked,
  indeterminate,
  className,
  ...props
}: {
  checked: boolean;
  indeterminate?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "checked">) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);

  const marcado = checked || !!indeterminate;

  return (
    <span className={cn("relative inline-grid h-4 w-4 shrink-0 place-items-center", className)}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        className={cn(
          "h-4 w-4 cursor-pointer appearance-none rounded-full border transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
          "disabled:cursor-not-allowed disabled:opacity-50",
          marcado ? "border-brand bg-brand" : "border-line-strong bg-surface hover:border-brand/60",
        )}
        {...props}
      />
      {marcado && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center text-on-brand">
          {checked ? <Check size={11} strokeWidth={3.5} /> : <Minus size={11} strokeWidth={3.5} />}
        </span>
      )}
    </span>
  );
}
