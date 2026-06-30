import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { loadPedidosCompra, loadComprasFormOptions } from "../_data";
import { ComprasClient } from "./_client";

export default async function ComprasPage() {
  const ctx = await requireActiveTenant();
  const [pedidos, formOptions] = await withTenant(ctx, async () => {
    const [p, opts] = await Promise.all([loadPedidosCompra(), loadComprasFormOptions()]);
    return [p, opts] as const;
  });

  const serializados = pedidos.map((p) => ({
    ...p,
    previsaoEntrega: p.previsaoEntrega?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    enviadoEm: p.enviadoEm?.toISOString() ?? null,
  }));

  return <ComprasClient pedidos={serializados} formOptions={formOptions} />;
}
