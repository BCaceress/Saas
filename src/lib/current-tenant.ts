import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { basePrisma } from "./prisma";
import { runWithTenant } from "./tenant-context";
import { getSubdomainFromHost } from "./subdomain";
import type { Tenant } from "@/generated/prisma";
import {
  type Acesso,
  type Permissao,
  can,
  isAdmin,
  podeEmAlguma,
  sitesPermitidos,
  assertCan,
  assertAdmin,
} from "./permissoes";

export type ActiveTenant = {
  tenant: Tenant;
  /** Acessos (perfil × loja) do usuário neste tenant. União = poder efetivo. */
  acessos: Acesso[];
  /** Dono da conta — cobrança. Não confere permissão por si só. */
  proprietario: boolean;
  membershipId: string;
  user: { id: string; name?: string | null; email?: string | null; image?: string | null };
};

/**
 * Resolve o tenant ativo a partir do subdomínio (header posto no middleware)
 * + verifica que o usuário logado é membro. Usa o client cru (basePrisma) de
 * propósito: a verificação acontece ANTES de entrar no contexto de tenant.
 * Retorna null se algo falhar (sem subdomínio, sem sessão, sem membership).
 */
export async function getActiveTenant(): Promise<ActiveTenant | null> {
  const h = await headers();
  const sub = getSubdomainFromHost(h.get("host"));
  if (!sub) return null;

  const session = await auth();
  if (!session?.user?.id) return null;

  const tenant = await basePrisma.tenant.findUnique({
    where: { subdomain: sub },
  });
  if (!tenant) return null;

  const membership = await basePrisma.membership.findUnique({
    where: { userId_tenantId: { userId: session.user.id, tenantId: tenant.id } },
    include: { acessos: { select: { perfil: true, siteId: true } } },
  });
  if (!membership || !membership.ativo) return null;

  return {
    tenant,
    acessos: membership.acessos,
    proprietario: membership.proprietario,
    membershipId: membership.id,
    user: session.user,
  };
}

/**
 * Exige tenant ativo; redireciona para login no domínio raiz se não houver.
 * Use no topo de páginas/layouts autenticados.
 */
export async function requireActiveTenant(): Promise<ActiveTenant> {
  const ctx = await getActiveTenant();
  if (!ctx) redirect("/login");
  return ctx;
}

/**
 * Roda `fn` já dentro do contexto de tenant (ALS) — toda query via `db` herda
 * o tenantId. Padrão para páginas/actions: const data = await withTenant(ctx, …).
 */
export function withTenant<T>(
  ctx: ActiveTenant,
  fn: (ctx: ActiveTenant) => Promise<T>
): Promise<T> {
  return runWithTenant(ctx.tenant.id, () => fn(ctx));
}

const TOUCH_INTERVALO_MS = 15 * 60 * 1000;

/**
 * Carimba `ultimoAcesso` no Membership, no máximo a cada 15 min por pessoa.
 * Best-effort: falha aqui nunca derruba a página.
 */
export async function touchUltimoAcesso(membershipId: string): Promise<void> {
  const limite = new Date(Date.now() - TOUCH_INTERVALO_MS);
  try {
    await basePrisma.membership.updateMany({
      where: {
        id: membershipId,
        OR: [{ ultimoAcesso: null }, { ultimoAcesso: { lt: limite } }],
      },
      data: { ultimoAcesso: new Date() },
    });
  } catch {
    // silencioso de propósito
  }
}

// ── Permissões sobre o contexto ativo ───────────────────────
// Açúcar em cima de lib/permissoes — evita repetir `ctx.acessos` no call site.

export const ctxIsAdmin = (ctx: ActiveTenant) => isAdmin(ctx.acessos);

export const ctxCan = (ctx: ActiveTenant, p: Permissao, siteId: string) =>
  can(ctx.acessos, p, siteId);

export const ctxPodeEmAlguma = (ctx: ActiveTenant, p: Permissao) =>
  podeEmAlguma(ctx.acessos, p);

export const ctxSites = (ctx: ActiveTenant, p: Permissao) =>
  sitesPermitidos(ctx.acessos, p);

/** Exige a permissão na loja informada; lança SemPermissaoError. */
export const ctxAssertCan = (ctx: ActiveTenant, p: Permissao, siteId: string) =>
  assertCan(ctx.acessos, p, siteId);

/** Exige perfil ADMINISTRADOR (configurações, equipe, dados do tenant). */
export const ctxAssertAdmin = (ctx: ActiveTenant) => assertAdmin(ctx.acessos);

/**
 * Exige tenant ativo + perfil de administrador, já entregando o contexto.
 * Atalho para páginas/actions de Configurações.
 */
export async function requireAdmin(): Promise<ActiveTenant> {
  const ctx = await requireActiveTenant();
  ctxAssertAdmin(ctx);
  return ctx;
}
