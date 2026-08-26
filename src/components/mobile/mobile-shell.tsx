"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { AlertsProvider } from "@/components/app/alerts-provider";
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
  multiSite,
  children,
}: {
  acessos: Acesso[];
  toggles: NavToggles;
  /** A empresa tem mais de um local ativo (esconde transferência na folha). */
  multiSite: boolean;
  children: React.ReactNode;
}) {
  // Não há barra de topo em tela nenhuma: empresa e sino são conteúdo da home,
  // e repeti-los em corpo menor no topo das outras telas só comia altura útil
  // (14px de barra + área segura) sem dizer nada que a tela já não diga. Quem
  // quer alertas fora da home vai pela aba. O `home` sobrevive só para o
  // respiro: lá o cabeçalho é a manchete e pede mais ar.
  const home = usePathname() === "/m";

  return (
    <AlertsProvider>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-100 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-on-brand"
      >
        Pular para o conteúdo
      </a>

      <div data-mobile-shell className="flex min-h-dvh flex-col bg-canvas">
        {/* pb-32 reserva a barra flutuante (64px + respiro + área segura): sem
            isso o último card fica embaixo dela. O px-4 é a margem de conteúdo
            da superfície inteira — quem sangra até a borda cancela com
            `-mx-4 px-4`. Sem barra de topo, o `<main>` é quem responde pela
            área segura em TODAS as telas: sem isso o título fica sob o notch. */}
        <main
          id="conteudo"
          className={cn(
            "flex-1 px-4 pb-32",
            home
              ? "pt-[calc(env(safe-area-inset-top)+1.5rem)]"
              : "pt-[calc(env(safe-area-inset-top)+1rem)]",
          )}
        >
          {children}
        </main>

        {/* Sem botão flutuante do copiloto: no celular ele disputava o polegar
            com a barra de abas e cobria o canto onde as telas de operação põem
            suas ações. A IA tem tela própria em `/m/ia`, alcançada por "Mais". */}
        <MobileTabBar acessos={acessos} toggles={toggles} multiSite={multiSite} />
      </div>
    </AlertsProvider>
  );
}
