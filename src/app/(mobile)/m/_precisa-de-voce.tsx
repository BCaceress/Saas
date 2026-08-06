"use client";

import Link from "next/link";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { useAlerts } from "@/components/app/alerts-provider";
import { AlertaCard } from "@/components/mobile/alerta-card";
import { Card } from "@/components/ui/misc";

/**
 * "Precisa de você" — os alertas mais graves, no topo da home.
 *
 * Lê do `AlertsProvider` em vez de chamar `getAlerts()` no servidor. Dois
 * motivos: o provider já faz essa chamada uma vez por carga (repetir no
 * servidor dobraria as ~6 consultas pesadas do `_alerts.ts`), e ele já
 * desconta o que a pessoa marcou como resolvido — coisa que o servidor não
 * sabe, porque isso mora no localStorage do aparelho.
 */
export function PrecisaDeVoce() {
  const { alerts, loaded } = useAlerts();

  if (!loaded) {
    return (
      <div className="space-y-2">
        <Card className="h-24 animate-pulse bg-surface-2" />
        <Card className="h-24 animate-pulse bg-surface-2" />
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <Card className="flex items-center gap-3 p-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ok-soft text-ok">
          <CheckCircle2 className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-semibold text-ink">Tudo em ordem</p>
          <p className="text-[13px] text-ink-2">Nenhuma pendência agora.</p>
        </div>
      </Card>
    );
  }

  // `alerts` já vem ordenado por categoria e prioridade do provider.
  const top = alerts.slice(0, 3);
  const resto = alerts.length - top.length;

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-base font-semibold text-ink">Precisa de você</h2>
        <span className="text-xs text-muted">
          {alerts.length} {alerts.length === 1 ? "pendência" : "pendências"}
        </span>
      </div>

      {top.map((a) => (
        <AlertaCard key={a.id} alerta={a} />
      ))}

      {resto > 0 && (
        <Link
          href="/m/alertas"
          className="flex min-h-11 items-center justify-center gap-1 rounded-full text-[13px] font-medium text-brand hover:bg-brand-soft focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          Ver mais {resto} {resto === 1 ? "alerta" : "alertas"}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      )}
    </section>
  );
}
