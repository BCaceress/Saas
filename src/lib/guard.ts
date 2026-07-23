import "server-only";
import { redirect } from "next/navigation";
import { requireActiveTenant, type ActiveTenant } from "./current-tenant";
import { podeEmAlguma, can, SemPermissaoError, type Permissao } from "./permissoes";
import {
  featureAtiva,
  temFeature,
  togglesEfetivos,
  cabeMais,
  limitesDe,
  mensagemLimite,
  PlanoInsuficienteError,
  type Feature,
  type Limites,
} from "./planos";
import { rotaInicial } from "@/components/app/nav-config";

// ============================================================
// Guard de PÁGINA. Esconder item do menu é cosmético — quem digita a URL entra
// do mesmo jeito. Todo módulo chama isto no seu layout.tsx.
//
// Escrita usa `guardAction`, que LANÇA em vez de redirecionar — server action
// não tem para onde navegar, e o erro vira toast na tela.
// ============================================================

/**
 * Guard de SERVER ACTION. Chamado no `tx()` de cada módulo, então nenhuma ação
 * roda sem passar por aqui — inclusive requisição forjada, que não depende da
 * tela ter sido aberta.
 *
 * Com `siteId`, exige a permissão NAQUELA loja (é o que faz o acesso por loja
 * valer de verdade). Sem `siteId`, exige em alguma — use só quando a ação não
 * pertence a uma loja específica.
 */
export async function guardAction(
  permissao: Permissao,
  siteId?: string | null,
): Promise<ActiveTenant> {
  const ctx = await requireActiveTenant();
  const ok = siteId ? can(ctx.acessos, permissao, siteId) : podeEmAlguma(ctx.acessos, permissao);
  if (!ok) throw new SemPermissaoError();
  return ctx;
}

/** Exige a permissão numa loja específica, com o contexto já em mãos. */
export function assertSite(
  ctx: ActiveTenant,
  permissao: Permissao,
  siteId: string,
): void {
  if (!can(ctx.acessos, permissao, siteId)) {
    throw new SemPermissaoError("Você não tem acesso a esta loja.");
  }
}

/**
 * Exige a permissão em ALGUMA loja para abrir a tela. Sem ela, manda para a
 * primeira rota que a pessoa pode ver — ou para /sem-acesso, se não puder nada.
 */
export async function requirePermissao(permissao: Permissao): Promise<ActiveTenant> {
  const ctx = await requireActiveTenant();
  if (podeEmAlguma(ctx.acessos, permissao)) return ctx;

  redirect(rotaInicial(ctx.acessos, togglesEfetivos(ctx.tenant)) ?? "/sem-acesso");
}

// ============================================================
// Guard de PLANO. Permissão responde "essa pessoa pode?"; plano responde "essa
// conta contratou?". São perguntas independentes — um administrador tem todas
// as permissões e mesmo assim não abre um módulo fora do plano.
// ============================================================

/**
 * Exige a feature ATIVA (plano libera + operador ligou) para abrir a tela.
 * Manda para a tela de planos quando falta contrato — é upsell, não erro — e
 * para Módulos quando só falta ligar o toggle.
 */
export async function requireFeature(feature: Feature): Promise<ActiveTenant> {
  const ctx = await requireActiveTenant();
  if (featureAtiva(ctx.tenant, feature)) return ctx;
  redirect(temFeature(ctx.tenant, feature) ? "/configuracoes/modulos" : "/configuracoes/plano");
}

/**
 * Guard de plano para server action. Lança `PlanoInsuficienteError`, que a
 * action converte em toast com o texto de upgrade.
 */
export function assertFeature(ctx: ActiveTenant, feature: Feature): void {
  if (!featureAtiva(ctx.tenant, feature)) throw new PlanoInsuficienteError(feature);
}

/** Permissão + plano numa chamada só — o par que toda action de módulo pago precisa. */
export async function guardFeature(
  feature: Feature,
  permissao: Permissao,
  siteId?: string | null,
): Promise<ActiveTenant> {
  const ctx = await guardAction(permissao, siteId);
  assertFeature(ctx, feature);
  return ctx;
}

/**
 * Exige que ainda caiba mais um (loja, usuário, produto). `usados` é a contagem
 * atual — conte DENTRO da mesma transação para não passar do limite em corrida.
 */
export function assertLimite(
  ctx: ActiveTenant,
  chave: keyof Limites,
  usados: number,
): void {
  if (cabeMais(ctx.tenant, chave, usados)) return;
  const limite = limitesDe(ctx.tenant)[chave] ?? 0;
  throw new PlanoInsuficienteError(null, mensagemLimite(chave, limite));
}
