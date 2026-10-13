"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Select de filtro com seleção múltipla. Nada marcado = sem filtro (o gatilho
 * mostra `placeholder`). A lista fica aberta enquanto a pessoa marca — fechar
 * a cada clique obrigaria a reabrir para escolher o segundo.
 */
export function MultiSelect<T extends string>({
  options,
  value,
  onChange,
  placeholder,
  ariaLabel,
  plural,
  className,
}: {
  options: { value: T; label: string; count?: number | null }[];
  value: T[];
  onChange: (next: T[]) => void;
  /** Rótulo do gatilho sem nada marcado — ex.: "Todos os status". */
  placeholder: string;
  ariaLabel: string;
  /** Substantivo do resumo com 2+ marcados — ex.: "status" → "3 status". */
  plural: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const marcados = options.filter((o) => value.includes(o.value));
  const rotulo =
    marcados.length === 0
      ? placeholder
      : marcados.length === 1
        ? marcados[0].label
        : `${marcados.length} ${plural}`;

  const alternar = (v: T) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-full border bg-surface px-3.5 text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:outline-none",
          marcados.length > 0 ? "border-brand text-ink" : "border-line text-ink",
        )}
      >
        <span className="truncate">{rotulo}</span>
        <ChevronDown
          size={14}
          className={cn("shrink-0 text-muted transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable
          aria-label={ariaLabel}
          className="absolute top-full left-0 z-30 mt-1 min-w-full overflow-hidden rounded-[var(--radius)] border border-line bg-surface p-1.5 shadow-[var(--shadow-2)]"
        >
          {options.map((o) => {
            const marcado = value.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={marcado}
                onClick={() => alternar(o.value)}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-[13px] whitespace-nowrap text-ink transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
              >
                <span
                  className={cn(
                    "grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border transition-colors",
                    marcado ? "border-brand bg-brand text-on-brand" : "border-line-button bg-surface",
                  )}
                  aria-hidden
                >
                  {marcado && <Check size={12} strokeWidth={3} />}
                </span>
                <span className="flex-1">{o.label}</span>
                {o.count != null && o.count > 0 && (
                  <span className="tabular-nums text-muted">{o.count}</span>
                )}
              </button>
            );
          })}

          {marcados.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full cursor-pointer border-t border-line px-2.5 pt-2 pb-1 text-left text-xs font-medium text-muted transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none"
            >
              Limpar seleção
            </button>
          )}
        </div>
      )}
    </div>
  );
}
