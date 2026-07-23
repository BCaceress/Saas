import { redirect } from "next/navigation";
import { requireActiveTenant, touchUltimoAcesso } from "@/lib/current-tenant";
import { AppShell } from "@/components/app/app-shell";
import { Toaster } from "@/components/ui/toast";
import { caixaAbertoDoOperador, relatorioCaixa } from "@/lib/caixa";
import { listSitePaymentMethods } from "@/lib/vendas";
import { signOutAction } from "./actions";
import { PERFIL_LABEL, isAdmin, type Acesso } from "@/lib/permissoes";
import { togglesEfetivos, PLANOS } from "@/lib/planos";

function trialDaysLeft(trialEndsAt: Date | null): number | null {
  if (!trialEndsAt) return null;
  const ms = trialEndsAt.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/** Rótulo curto do cargo: administrador manda; senão, os perfis que a pessoa tem. */
function cargoLabel(acessos: Acesso[]): string {
  if (isAdmin(acessos)) return PERFIL_LABEL.ADMINISTRADOR;
  const perfis = [...new Set(acessos.map((a) => a.perfil))];
  if (perfis.length === 0) return "Sem acesso";
  if (perfis.length > 2) return `${PERFIL_LABEL[perfis[0]]} +${perfis.length - 1}`;
  return perfis.map((p) => PERFIL_LABEL[p]).join(" · ");
}

const STATUS_LABEL: Record<string, string> = {
  PAST_DUE: "Pendente",
  SUSPENDED: "Suspenso",
  CANCELED: "Cancelado",
};

/**
 * Selo do topo: em teste ou com pendência, o STATUS é a informação urgente;
 * assinatura em dia mostra o plano contratado, que é o que dá upsell.
 */
function planoLabel(tenant: { plano: keyof typeof PLANOS; status: string }): string {
  if (tenant.status === "TRIAL") return "Teste";
  return STATUS_LABEL[tenant.status] ?? PLANOS[tenant.plano].nome;
}

export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requireActiveTenant();
  const { tenant, user, acessos } = ctx;

  // Sem onboarding concluído, manda concluir antes de entrar no app.
  if (!tenant.onboardingDone) redirect("/onboarding");

  await touchUltimoAcesso(ctx.membershipId);

  const vocabularioPonto = tenant.tipoOperacao === "AUTONOMO" ? "Ponto" : "Loja";

  // Plano + toggle. Ler o toggle cru abriria módulo de graça depois de downgrade.
  const toggles = togglesEfetivos(tenant);

  const sessaoAberta = toggles.moduloPdv
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
      toggles={toggles}
      acessos={acessos}
      tenantNome={tenant.nome}
      planoLabel={planoLabel(tenant)}
      userNome={user.name ?? ""}
      userEmail={user.email ?? ""}
      userCargo={cargoLabel(acessos)}
      podeConfigurar={isAdmin(acessos)}
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
