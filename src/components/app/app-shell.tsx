"use client";

import { useCallback, useEffect, useState } from "react";
import { Sidebar, type SidebarToggles } from "@/components/app/sidebar";
import { Navbar } from "@/components/app/navbar";
import { MobileNav } from "@/components/app/mobile-nav";
import { BottomNav } from "@/components/app/bottom-nav";
import { CommandPalette } from "@/components/app/command-palette";
import { CopilotoLauncher } from "@/components/app/copiloto/copiloto-launcher";
import { AlertsProvider } from "@/components/app/alerts-provider";
import type { CaixaInfo } from "@/components/app/caixa-sheet";
import type { PaymentMethod } from "@/generated/prisma";
import type { Acesso } from "@/lib/permissoes";

/** Cookie do menu recolhido — lido no servidor por `(app)/layout.tsx`. */
export const NAV_COLLAPSED_COOKIE = "nav_collapsed";

export function AppShell({
  toggles,
  acessos,
  tenantNome,
  planoLabel,
  userNome,
  userEmail,
  userCargo,
  podeConfigurar,
  podeCopiloto,
  menuRecolhido,
  trialDias,
  vocabularioPonto,
  multiPonto,
  caixaInfo,
  metodosCaixa,
  limiteGaveta,
  onSignOut,
  children,
}: {
  toggles: SidebarToggles;
  acessos: Acesso[];
  tenantNome: string;
  planoLabel: string;
  userNome: string;
  userEmail: string;
  userCargo: string;
  /** Só administrador vê o atalho de Configurações na navbar. */
  podeConfigurar: boolean;
  /** Plano com o add-on de IA contratado e ativo + permissão de relatório. */
  podeCopiloto: boolean;
  /** Estado do menu na carga anterior, vindo do cookie. */
  menuRecolhido: boolean;
  trialDias: number | null;
  vocabularioPonto: string;
  multiPonto: boolean;
  caixaInfo: CaixaInfo | null;
  metodosCaixa: PaymentMethod[];
  limiteGaveta?: number | null;
  onSignOut: () => void;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(menuRecolhido);
  const [drawerAberto, setDrawerAberto] = useState(false);
  const [buscaAberta, setBuscaAberta] = useState(false);

  // Trava a viewport enquanto o shell estiver na tela: quem rola é o <main>.
  // Sem isso sobra um scroll no documento e a tela inteira — sidebar e navbar
  // junto — sobe ao chegar no fim do conteúdo.
  useEffect(() => {
    document.documentElement.classList.add("app-lock");
    return () => document.documentElement.classList.remove("app-lock");
  }, []);

  // Ctrl/⌘+K de qualquer lugar. O `preventDefault` é necessário: no Firefox o
  // atalho é da barra de endereços.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      setBuscaAberta((v) => !v);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Um ano é bastante: a preferência de menu não muda de semana em semana, e
  // o servidor já renderiza na largura certa na próxima visita.
  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      const proximo = !c;
      document.cookie = `${NAV_COLLAPSED_COOKIE}=${proximo ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
      return proximo;
    });
  }, []);

  return (
    <AlertsProvider>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-100 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-on-brand"
      >
        Pular para o conteúdo
      </a>

      {/* `data-app-shell` é o gancho do globals.css que trava o scroll do body:
          o shell ocupa a viewport exata e quem rola é o <main>. Sem isso sobra
          um segundo scroll por fora e a tela inteira (sidebar + navbar) sobe. */}
      <div
        data-app-shell
        className="flex h-dvh gap-0 overflow-hidden bg-canvas p-2 sm:gap-3 sm:p-3"
      >
        <Sidebar
          toggles={toggles}
          acessos={acessos}
          collapsed={collapsed}
          planoLabel={planoLabel}
          trialDias={trialDias}
        />

        <MobileNav
          open={drawerAberto}
          onClose={() => setDrawerAberto(false)}
          toggles={toggles}
          acessos={acessos}
          planoLabel={planoLabel}
          trialDias={trialDias}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <Navbar
            onToggleSidebar={toggleSidebar}
            onAbrirMenu={() => setDrawerAberto(true)}
            onAbrirBusca={() => setBuscaAberta(true)}
            sidebarCollapsed={collapsed}
            tenantNome={tenantNome}
            userNome={userNome}
            userEmail={userEmail}
            userCargo={userCargo}
            podeConfigurar={podeConfigurar}
            vocabularioPonto={vocabularioPonto}
            multiPonto={multiPonto}
            caixaInfo={caixaInfo}
            metodosCaixa={metodosCaixa}
            limiteGaveta={limiteGaveta}
            onSignOut={onSignOut}
          />
          <main
            id="conteudo"
            className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1 pb-20 sm:px-2 md:pb-2"
          >
            {children}
          </main>
        </div>

        <BottomNav
          toggles={toggles}
          acessos={acessos}
          onAbrirMenu={() => setDrawerAberto(true)}
          menuAberto={drawerAberto}
        />

        <CommandPalette
          open={buscaAberta}
          onClose={() => setBuscaAberta(false)}
          acessos={acessos}
          toggles={toggles}
        />

        <CopilotoLauncher podeVer={podeCopiloto} />
      </div>
    </AlertsProvider>
  );
}
