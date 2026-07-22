import "server-only";
import { redirect } from "next/navigation";
import { requireActiveTenant, type ActiveTenant } from "./current-tenant";
import { podeEmAlguma, can, SemPermissaoError, type Permissao } from "./permissoes";
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

  const destino = rotaInicial(ctx.acessos, {
    moduloPdv: ctx.tenant.moduloPdv,
    moduloComodato: ctx.tenant.moduloComodato,
    moduloRota: ctx.tenant.moduloRota,
    moduloAutoatendimento: ctx.tenant.moduloAutoatendimento,
    moduloFiscal: ctx.tenant.moduloFiscal,
  });
  redirect(destino ?? "/sem-acesso");
}
