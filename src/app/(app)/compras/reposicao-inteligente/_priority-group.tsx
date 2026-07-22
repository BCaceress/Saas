"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Grupo de prioridade — Risco de ruptura / Comprar em breve /
// Já em reposição. Expansível, com seleção do grupo inteiro.

const TOM = {
  danger: { text: "text-danger", dot: "bg-danger", badge: "bg-danger-soft text-danger" },
  warn: { text: "text-warn", dot: "bg-warn", badge: "bg-warn-soft text-warn" },
  ok: { text: "text-ok", dot: "bg-ok", badge: "bg-ok-soft text-ok" },
} as const;

export function PriorityGroup({
  titulo,
  descricao,
  tom,
  icon: Icon,
  count,
  defaultOpen = true,
  selecionados,
  selecionaveis,
  onToggleTodos,
  children,
}: {
  titulo: string;
  descricao: string;
  tom: keyof typeof TOM;
  icon: React.ElementType;
  count: number;
  defaultOpen?: boolean;
  /** Quantos itens do grupo estão marcados (omitido no grupo "Já em reposição"). */
  selecionados?: number;
  selecionaveis?: number;
  onToggleTodos?: (on: boolean) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const t = TOM[tom];
  const todosMarcados = selecionaveis != null && selecionaveis > 0 && selecionados === selecionaveis;

  return (
    <section className="flex flex-col">
      <div className="flex items-center gap-2 px-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1.5 text-left transition-colors hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
        >
          <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", t.badge)}>
            <Icon size={15} />
          </span>
          <span className="min-w-0">
            <span className={cn("flex items-center gap-2 font-display text-sm font-bold", t.text)}>
              {titulo}
              <span className={cn("rounded-full px-2 py-px text-[11px] font-semibold tabular-nums", t.badge)}>{count}</span>
            </span>
            <span className="block truncate text-xs text-muted">{descricao}</span>
          </span>
          <ChevronDown
            size={16}
            className={cn("ml-auto shrink-0 text-muted transition-transform motion-reduce:transition-none", open && "rotate-180")}
          />
        </button>
        {onToggleTodos && selecionaveis != null && selecionaveis > 0 && open && (
          <button
            type="button"
            onClick={() => onToggleTodos(!todosMarcados)}
            className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-semibold text-brand transition-colors hover:bg-brand-soft"
          >
            {todosMarcados ? "Desmarcar grupo" : "Selecionar grupo"}
          </button>
        )}
      </div>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-4 pt-2.5 pb-1">{children}</div>
        </div>
      </div>
    </section>
  );
}
