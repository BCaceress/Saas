import { cookies } from "next/headers";
import { AppShell, NAV_COLLAPSED_COOKIE } from "@/components/app/app-shell";
import { FaixaAssinatura } from "@/components/app/faixa-assinatura";
import { Toaster } from "@/components/ui/toast";
import { carregarShell } from "@/lib/shell-context";
import { featureAtiva } from "@/lib/planos";
import { signOutAction } from "./actions";

export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Tenant, onboarding, cobrança e toggles vivem em lib/shell-context: a casca
  // mobile (/m) resolve exatamente o mesmo e não pode divergir daqui.
  const shell = await carregarShell({ comCaixa: true });
  const { ctx, toggles, acesso, caixaInfo, metodosCaixa } = shell;
  const { tenant, user, acessos } = ctx;

  // Menu recolhido vem em cookie, não em localStorage: o servidor já entrega a
  // sidebar na largura certa e ninguém vê os 60px pularem depois da hidratação.
  // Fica aqui, e não no shell-context, porque é preferência só do desktop.
  const menuRecolhido = (await cookies()).get(NAV_COLLAPSED_COOKIE)?.value === "1";

  return (
    <AppShell
      toggles={toggles}
      acessos={acessos}
      tenantNome={tenant.nome}
      planoLabel={shell.planoLabel}
      userNome={user.name ?? ""}
      userEmail={user.email ?? ""}
      userCargo={shell.cargoLabel}
      podeConfigurar={shell.admin}
      podeCopiloto={featureAtiva(tenant, "ia.copiloto") && shell.admin}
      menuRecolhido={menuRecolhido}
      trialDias={shell.trialDias}
      vocabularioPonto={shell.vocabularioPonto}
      multiPonto={shell.multiPonto}
      caixaInfo={caixaInfo}
      metodosCaixa={metodosCaixa}
      limiteGaveta={
        tenant.caixaLimiteGaveta != null ? Number(tenant.caixaLimiteGaveta) : null
      }
      onSignOut={signOutAction}
    >
      {acesso.aviso && (
        <FaixaAssinatura
          tom={acesso.aviso.tom}
          texto={acesso.aviso.texto}
          podeAssinar={shell.admin}
        />
      )}
      {children}
      <Toaster />
    </AppShell>
  );
}
