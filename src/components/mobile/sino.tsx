"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAlerts } from "@/components/app/alerts-provider";

/**
 * Sino de alertas. Único no app: a home o coloca ao lado da saudação, as
 * demais telas na barra do topo — mesmo alvo, mesma contagem, mesmo destino.
 *
 * Lê do `AlertsProvider` (uma viagem por carga, já descontando o que a pessoa
 * marcou como resolvido no aparelho).
 */
export function SinoAlertas({ className }: { className?: string }) {
  const { alerts, loaded } = useAlerts();
  const total = alerts.length;

  return (
    <Link
      href="/m/alertas"
      aria-label={
        loaded && total > 0
          ? `Alertas: ${total} ${total === 1 ? "pendência" : "pendências"}`
          : "Alertas"
      }
      className={cn(
        "tap relative grid h-11 w-11 shrink-0 place-items-center rounded-full",
        "border border-line bg-surface text-ink-2 shadow-[var(--shadow-m)]",
        "hover:border-line-strong active:bg-surface-2",
        "focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
        className,
      )}
    >
      <Bell className="h-5 w-5" strokeWidth={2} />
      {loaded && total > 0 && (
        // Contagem sai da borda do botão: é aviso, não rótulo — precisa ser
        // vista antes do ícone.
        <span className="fade-in-m absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] leading-none font-semibold text-white ring-2 ring-canvas">
          {total > 9 ? "9+" : total}
        </span>
      )}
    </Link>
  );
}
