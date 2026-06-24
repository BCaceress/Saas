import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { basePrisma } from "./prisma";
import { runWithTenant } from "./tenant-context";
import { getSubdomainFromHost } from "./subdomain";
import type { Role, Tenant } from "@/generated/prisma";

export type ActiveTenant = {
  tenant: Tenant;
  role: Role;
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
  });
  if (!membership) return null;

  return {
    tenant,
    role: membership.role,
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
