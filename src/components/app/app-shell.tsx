"use client";

import { useState } from "react";
import { Sidebar, type SidebarToggles } from "@/components/app/sidebar";
import { Navbar } from "@/components/app/navbar";
import type { CaixaInfo } from "@/components/app/caixa-sheet";
import type { PaymentMethod } from "@/generated/prisma";
import type { Acesso } from "@/lib/permissoes";

export function AppShell({
  toggles,
  acessos,
  tenantNome,
  planoLabel,
  userNome,
  userEmail,
  userCargo,
  podeConfigurar,
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
  trialDias: number | null;
  vocabularioPonto: string;
  multiPonto: boolean;
  caixaInfo: CaixaInfo | null;
  metodosCaixa: PaymentMethod[];
  limiteGaveta?: number | null;
  onSignOut: () => void;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-dvh gap-0 overflow-hidden bg-canvas p-2 sm:gap-3 sm:p-3">
      <Sidebar
        toggles={toggles}
        acessos={acessos}
        collapsed={collapsed}
        planoLabel={planoLabel}
        trialDias={trialDias}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <Navbar
          onToggleSidebar={() => setCollapsed((c) => !c)}
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
        <main className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1 pb-2 sm:px-2">
          {children}
        </main>
      </div>
    </div>
  );
}
