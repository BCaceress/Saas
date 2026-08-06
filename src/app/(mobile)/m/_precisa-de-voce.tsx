"use client";

import Link from "next/link";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { useAlerts } from "@/components/app/alerts-provider";
import { AlertaCard } from "@/components/mobile/alerta-card";
import { Bolha, MCard, MCardLink, SecaoTitulo } from "@/components/mobile/ui";

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
        <MCard className="h-24 animate-pulse bg-surface-2" />
        <MCard className="h-24 animate-pulse bg-surface-2" />
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      // Nada pendente é notícia boa: cartão calmo, verde só na bolha, e a seta
      // dizendo que o histórico continua ali — sossego, não beco sem saída.
      <MCardLink href="/m/alertas" className="fade-in-m flex items-center gap-3 p-4">
        <Bolha icone={CheckCircle2} tom="ok" tamanho="lg" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-base leading-tight font-semibold text-ink">
            Tudo em ordem
          </p>
          <p className="mt-0.5 text-[13px] text-muted">Nenhuma pendência agora.</p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-faint" aria-hidden />
      </MCardLink>
    );
  }

  // `alerts` já vem ordenado por categoria e prioridade do provider.
  const top = alerts.slice(0, 3);
  const resto = alerts.length - top.length;

  return (
    <section className="fade-in-m space-y-2">
      <SecaoTitulo
        acao={
          <span className="shrink-0 text-[13px] text-muted tabular-nums">
            {alerts.length} {alerts.length === 1 ? "pendência" : "pendências"}
          </span>
        }
      >
        Precisa de você
      </SecaoTitulo>

      {top.map((a) => (
        <AlertaCard key={a.id} alerta={a} />
      ))}

      {resto > 0 && (
        <Link
          href="/m/alertas"
          className="tap flex min-h-12 items-center justify-center gap-1 rounded-full text-base font-medium text-brand hover:bg-brand-soft active:bg-brand-soft focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          Ver mais {resto} {resto === 1 ? "alerta" : "alertas"}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      )}
    </section>
  );
}
