import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Etapa } from "../_etapas";

// ── Trilha de etapas ────────────────────────────────────────
// Enviada → Respostas → Decisão → Pedidos. A etapa atual é a única com cor
// cheia: é para lá que o olho vai, e é lá que está o trabalho de hoje.

export function TrilhaEtapas({ etapas }: { etapas: Etapa[] }) {
  return (
    <ol aria-label="Andamento da cotação" className="flex flex-wrap items-center gap-y-1.5">
      {etapas.map((e, i) => (
        <li key={e.id} className="flex items-center">
          {i > 0 && (
            <span
              aria-hidden
              className={cn(
                "mx-2 h-px w-5 sm:w-8",
                e.estado === "futuro" ? "bg-line" : "bg-ok/60",
              )}
            />
          )}
          <span
            aria-current={e.estado === "atual" ? "step" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-full py-0.5 text-[12px]",
              e.estado === "atual" && "bg-brand-soft pl-1 pr-2.5 font-semibold text-brand",
              e.estado === "feito" && "text-ok",
              e.estado === "futuro" && "text-faint",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "grid size-4 shrink-0 place-items-center rounded-full text-[9px] font-bold",
                e.estado === "atual" && "bg-brand text-on-brand",
                e.estado === "feito" && "bg-ok text-on-brand",
                e.estado === "futuro" && "border border-line-strong",
              )}
            >
              {e.estado === "feito" ? <Check size={10} strokeWidth={3} /> : i + 1}
            </span>
            {e.rotulo}
            {e.detalhe && (
              <span className={cn("font-normal", e.estado === "atual" ? "text-brand/80" : "text-muted")}>
                · {e.detalhe}
              </span>
            )}
            <span className="sr-only">
              {e.estado === "feito" ? "(concluída)" : e.estado === "atual" ? "(etapa atual)" : "(próxima)"}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
