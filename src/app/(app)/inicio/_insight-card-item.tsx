"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { registrarFeedbackInsight } from "./actions";
import { TrackedLink } from "./_tracked-link";
import { ICON_MAP, type Insight, type Tom } from "./_insights";

const TOM_ESTILO: Record<Tom, { borda: string; icone: string }> = {
  alerta: { borda: "border-l-danger", icone: "bg-danger-soft text-danger" },
  oportunidade: { borda: "border-l-violet", icone: "bg-violet-soft text-violet" },
  info: { borda: "border-l-info", icone: "bg-info-soft text-info" },
  sucesso: { borda: "border-l-ok", icone: "bg-ok-soft text-ok" },
};

/** Card individual de insight — dispensável (grava feedback e some da sessão). */
export function InsightCardItem({ insight }: { insight: Insight }) {
  const [dispensado, setDispensado] = useState(false);
  const Icone = ICON_MAP[insight.icone];
  const estilo = TOM_ESTILO[insight.tom];

  if (dispensado) return null;

  return (
    <li className={cn("group relative flex gap-3 rounded-xl border border-line border-l-2 p-3.5 pr-8 transition-colors hover:bg-surface-2", estilo.borda)}>
      <button
        type="button"
        onClick={() => {
          setDispensado(true);
          void registrarFeedbackInsight(insight.id, "IGNORADO");
        }}
        aria-label="Ignorar este insight"
        // `focus-visible:opacity-100`: sem isso o botão só existe pro mouse —
        // quem navega por teclado tabula até um alvo invisível.
        className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full text-faint opacity-0 transition-opacity hover:bg-black/5 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 print:hidden"
      >
        <X size={13} />
      </button>

      <span aria-hidden className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", estilo.icone)}>
        <Icone size={16} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{insight.titulo}</p>
        <p className="mt-0.5 text-sm text-muted">{insight.corpo}</p>
        {insight.cta && (
          <TrackedLink insightId={insight.id} href={insight.cta.href} className="mt-2 inline-block text-xs font-medium text-brand hover:underline">
            {insight.cta.label}
          </TrackedLink>
        )}
      </div>
    </li>
  );
}
