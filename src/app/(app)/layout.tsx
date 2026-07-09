import { redirect } from "next/navigation";
import { requireActiveTenant } from "@/lib/current-tenant";
import { AppShell } from "@/components/app/app-shell";
import { Toaster } from "@/components/ui/toast";
import { caixaAbertoDoOperador, relatorioCaixa } from "@/lib/caixa";
import { listSitePaymentMethods } from "@/lib/vendas";
import { signOutAction } from "./actions";
import type { Role } from "@/generated/prisma";

function trialDaysLeft(trialEndsAt: Date | null): number | null {
  if (!trialEndsAt) return null;
  const ms = trialEndsAt.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

const CARGO_LABEL: Record<string, string> = {
  OWNER: "Proprietário",
  ADMIN: "Administrador",
  MEMBER: "Operador",
  VIEWER: "Visualização",
};

const PLANO_LABEL: Record<string, string> = {
  TRIAL: "Teste",
  ACTIVE: "Pro",
  PAST_DUE: "Pendente",
  CANCELED: "Cancelado",
};

export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requireActiveTenant();
  const { tenant, user, role } = ctx;

  // Sem onboarding concluído, manda concluir antes de entrar no app.
  if (!tenant.onboardingDone) redirect("/onboarding");

  const vocabularioPonto = tenant.tipoOperacao === "AUTONOMO" ? "Ponto" : "Loja";

  const sessaoAberta = tenant.moduloPdv
    ? await caixaAbertoDoOperador(tenant.id, user.id ?? "")
    : null;

  const caixaInfo = sessaoAberta
    ? {
        id: sessaoAberta.id,
        siteNome: sessaoAberta.site.nome,
        abertaEm: sessaoAberta.abertaEm,
        valorAbertura: Number(sessaoAberta.valorAbertura),
        relatorio: await relatorioCaixa(tenant.id, sessaoAberta.id),
      }
    : null;

  const metodosCaixa = sessaoAberta
    ? (await listSitePaymentMethods(tenant.id, sessaoAberta.siteId))
        .filter((m) => m.ativo)
        .map((m) => m.metodo)
    : [];

  return (
    <AppShell
      toggles={{
        moduloPdv: tenant.moduloPdv,
        moduloComodato: tenant.moduloComodato,
        moduloRota: tenant.moduloRota,
        moduloAutoatendimento: tenant.moduloAutoatendimento,
      }}
      tenantNome={tenant.nome}
      planoLabel={PLANO_LABEL[tenant.status] ?? tenant.status}
      userNome={user.name ?? ""}
      userEmail={user.email ?? ""}
      userCargo={CARGO_LABEL[role as Role] ?? "Operador"}
      trialDias={tenant.status === "TRIAL" ? trialDaysLeft(tenant.trialEndsAt) : null}
      vocabularioPonto={vocabularioPonto}
      multiPonto={(tenant.numPontos ?? 1) > 1}
      caixaInfo={caixaInfo}
      metodosCaixa={metodosCaixa}
      limiteGaveta={
        tenant.caixaLimiteGaveta != null ? Number(tenant.caixaLimiteGaveta) : null
      }
      onSignOut={signOutAction}
    >
      {children}
      <Toaster />
    </AppShell>
  );
}
