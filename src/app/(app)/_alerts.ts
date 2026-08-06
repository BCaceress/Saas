"use server";

import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { computarAlertas, filtrarAlertas } from "@/lib/alertas/computar";
import type { AlertItem } from "@/lib/alerts-types";

/**
 * Alertas do sino, para o usuário logado.
 *
 * A computação mora em `lib/alertas/computar` porque o job de push precisa
 * dela sem ter requisição: aqui só resolvemos quem está pedindo e cortamos a
 * lista pela permissão dessa pessoa.
 *
 * A assinatura é a mesma de sempre — `AlertsProvider` e o sino não mudaram.
 */
export async function getAlerts(): Promise<AlertItem[]> {
  const ctx = await requireActiveTenant();
  return runWithTenant(ctx.tenant.id, async () => {
    const todos = await computarAlertas(ctx.tenant);
    return filtrarAlertas(todos, ctx.tenant, ctx.acessos);
  });
}
