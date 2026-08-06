"use client";

import Link from "next/link";
import { Bell, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { AlertsProvider, useAlerts } from "@/components/app/alerts-provider";
import { MobileTabBar } from "@/components/mobile/tab-bar";
import type { NavToggles } from "@/components/app/nav-config";
import type { Acesso } from "@/lib/permissoes";

/**
 * Casca da superfície mobile.
 *
 * NÃO reusa o `AppShell`: aquele monta sidebar, navbar, paleta de comandos e
 * copiloto — grafo de client components que não serve de nada num celular — e
 * ainda trava o scroll do documento (`app-lock`) para que quem role seja o
 * `<main>`. Aqui o modelo é o oposto e o normal da web: o documento rola, o
 * cabeçalho gruda no topo e a barra de polegar fica fixa no rodapé.
 *
 * O `AlertsProvider` é reaproveitado tal e qual: é ele que faz a única viagem a
 * `getAlerts()` e alimenta tanto o sino quanto os badges da barra.
 */
export function MobileShell({
  acessos,
  toggles,
  tenantNome,
  children,
}: {
  acessos: Acesso[];
  toggles: NavToggles;
  tenantNome: string;
  children: React.ReactNode;
}) {
  return (
    <AlertsProvider>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-100 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-on-brand"
      >
        Pular para o conteúdo
      </a>

      <div className="flex min-h-dvh flex-col bg-canvas">
        <Cabecalho tenantNome={tenantNome} />

        {/* pb-24 reserva a barra fixa: sem isso o último card fica embaixo dela. */}
        <main id="conteudo" className="flex-1 px-3 pt-3 pb-24">
          {children}
        </main>

        <MobileTabBar acessos={acessos} toggles={toggles} />
      </div>
    </AlertsProvider>
  );
}

function Cabecalho({ tenantNome }: { tenantNome: string }) {
  const { alerts, loaded } = useAlerts();
  const total = alerts.length;

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-line bg-surface px-3 pt-[env(safe-area-inset-top)]">
      <Link
        href="/m"
        className="flex min-w-0 flex-1 items-center gap-1 rounded-full focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      >
        <span className="truncate font-display text-sm font-semibold text-ink">
          {tenantNome}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
      </Link>

      <Link
        href="/m/alertas"
        aria-label={
          loaded && total > 0
            ? `Alertas: ${total} ${total === 1 ? "pendência" : "pendências"}`
            : "Alertas"
        }
        className={cn(
          "relative grid h-10 w-10 place-items-center rounded-full text-ink-2",
          "hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
        )}
      >
        <Bell className="h-5 w-5" />
        {loaded && total > 0 && (
          <span className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] leading-none font-semibold text-white ring-2 ring-surface">
            {total > 9 ? "9+" : total}
          </span>
        )}
      </Link>
    </header>
  );
}
