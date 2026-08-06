import "server-only";
import { redirect } from "next/navigation";
import { requireActiveTenant, touchUltimoAcesso, type ActiveTenant } from "./current-tenant";
import { estadoAcesso, type EstadoAcesso } from "./assinatura";
import { caixaAbertoDoOperador, relatorioCaixa } from "./caixa";
import { listSitePaymentMethods } from "./vendas";
import { PERFIL_LABEL, isAdmin, type Acesso } from "./permissoes";
import { togglesEfetivos, PLANOS } from "./planos";
import type { CaixaInfo } from "@/components/app/caixa-sheet";
import type { PaymentMethod } from "@/generated/prisma";

/**
 * Contexto comum das superfícies autenticadas.
 *
 * Existe porque há DUAS cascas hoje — o shell de desktop em `(app)/layout.tsx`
 * e o mobile em `(mobile)/m/layout.tsx` — e as duas precisam exatamente da
 * mesma resolução: tenant ativo, gate de onboarding, estado de cobrança e
 * toggles cruzados com o plano. Duplicar isso seria duplicar os guards.
 *
 * O caixa fica atrás de uma opção porque `relatorioCaixa` é leitura cara: só a
 * navbar do desktop e a tela `/m/caixa` precisam dele. A home mobile não paga.
 */

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

/** Rótulo curto do cargo: administrador manda; senão, os perfis que a pessoa tem. */
function cargoLabel(acessos: Acesso[]): string {
  if (isAdmin(acessos)) return PERFIL_LABEL.ADMINISTRADOR;
  const perfis = [...new Set(acessos.map((a) => a.perfil))];
  if (perfis.length === 0) return "Sem acesso";
  if (perfis.length > 2) return `${PERFIL_LABEL[perfis[0]]} +${perfis.length - 1}`;
  return perfis.map((p) => PERFIL_LABEL[p]).join(" · ");
}

export type ShellData = {
  ctx: ActiveTenant;
  /** Toggles já cruzados com o plano — é o que a navegação consome. */
  toggles: ReturnType<typeof togglesEfetivos>;
  acesso: EstadoAcesso;
  /** Dias restantes do teste, ou null fora do trial. */
  trialDias: number | null;
  planoLabel: string;
  cargoLabel: string;
  /** "Ponto" para autônomo, "Loja" para o resto — o operador chama do jeito dele. */
  vocabularioPonto: string;
  multiPonto: boolean;
  admin: boolean;
  /** Só com `comCaixa`; fora disso é sempre null. */
  caixaInfo: CaixaInfo | null;
  metodosCaixa: PaymentMethod[];
};

export async function carregarShell(
  opcoes: { comCaixa?: boolean } = {},
): Promise<ShellData> {
  const ctx = await requireActiveTenant();
  const { tenant, user, acessos } = ctx;

  // Sem onboarding concluído, manda concluir antes de entrar no app.
  if (!tenant.onboardingDone) redirect("/onboarding");

  await touchUltimoAcesso(ctx.membershipId);

  // Cobrança: lê só o que já está no Tenant — nada de consultar gateway no
  // caminho de cada página.
  const acesso = estadoAcesso(tenant);

  // Plano + toggle. Ler o toggle cru abriria módulo de graça depois de downgrade.
  const toggles = togglesEfetivos(tenant);

  const sessaoAberta =
    opcoes.comCaixa && toggles.moduloPdv
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

  return {
    ctx,
    toggles,
    acesso,
    // Mesmo cálculo que o layout fazia à mão: status TRIAL + trialEndsAt.
    trialDias: acesso.diasTrial,
    planoLabel: planoLabel(tenant),
    cargoLabel: cargoLabel(acessos),
    vocabularioPonto: tenant.tipoOperacao === "AUTONOMO" ? "Ponto" : "Loja",
    multiPonto: (tenant.numPontos ?? 1) > 1,
    admin: isAdmin(acessos),
    caixaInfo,
    metodosCaixa,
  };
}
