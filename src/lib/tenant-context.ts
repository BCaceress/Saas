import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Contexto de tenant da request corrente.
 * Preenchido no middleware/handlers após resolver o subdomínio (PRD §3.2).
 * O Client Extension (lib/prisma.ts) lê daqui para injetar tenantId em toda query.
 */
export type TenantContext = {
  tenantId: string;
};

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

/** Roda `fn` com o tenant fixado no contexto async. */
export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  return tenantStorage.run({ tenantId }, fn);
}

/** tenantId atual ou erro — use quando o tenant é obrigatório. */
export function requireTenantId(): string {
  const ctx = tenantStorage.getStore();
  if (!ctx?.tenantId) {
    throw new Error(
      "Sem contexto de tenant. Toda operação de negócio precisa rodar dentro de runWithTenant()."
    );
  }
  return ctx.tenantId;
}

/** tenantId atual ou null — quando a ausência é aceitável. */
export function getTenantId(): string | null {
  return tenantStorage.getStore()?.tenantId ?? null;
}
