"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { AlertsProvider } from "@/components/app/alerts-provider";
import { MobileTabBar } from "@/components/mobile/tab-bar";
import { SinoAlertas } from "@/components/mobile/sino";
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
  multiSite,
  children,
}: {
  acessos: Acesso[];
  toggles: NavToggles;
  tenantNome: string;
  /** A empresa tem mais de um local ativo (esconde transferência na folha). */
  multiSite: boolean;
  children: React.ReactNode;
}) {
  // Na home a barra do topo sairia repetindo o que a própria tela já diz —
  // empresa, sino — em corpo menor. Lá o cabeçalho é o conteúdo (saudação,
  // empresa, sino), então a barra fica de fora e o `<main>` assume a área
  // segura do aparelho.
  const home = usePathname() === "/m";

  return (
    <AlertsProvider>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-100 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-on-brand"
      >
        Pular para o conteúdo
      </a>

      <div className="flex min-h-dvh flex-col bg-canvas">
        {!home && <Cabecalho tenantNome={tenantNome} />}

        {/* pb-32 reserva a barra flutuante (64px + respiro + área segura): sem
            isso o último card fica embaixo dela. O px-4 é a margem de conteúdo
            da superfície inteira — quem sangra até a borda cancela com
            `-mx-4 px-4`. */}
        <main
          id="conteudo"
          className={cn(
            "flex-1 px-4 pb-32",
            home ? "pt-[calc(env(safe-area-inset-top)+1.5rem)]" : "pt-4",
          )}
        >
          {children}
        </main>

        <MobileTabBar acessos={acessos} toggles={toggles} multiSite={multiSite} />
      </div>
    </AlertsProvider>
  );
}

function Cabecalho({ tenantNome }: { tenantNome: string }) {
  return (
    // Fundo do canvas, não do card: a barra é contexto, não conteúdo. A borda
    // só aparece quando a página rolou por baixo dela.
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-line/70 bg-canvas/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur">
      {/* Empresa é rótulo de onde você está, não a manchete da tela — texto
          pequeno e em tinta secundária. O destaque é o nome de quem abriu o
          app, e esse mora no cabeçalho da home. */}
      <Link
        href="/m"
        className="tap flex min-w-0 flex-1 items-center gap-1 rounded-[var(--radius-m)] py-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      >
        <span className="truncate text-[13px] font-medium tracking-wide text-ink-2">
          {tenantNome}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
      </Link>

      <SinoAlertas className="-mr-1" />
    </header>
  );
}
