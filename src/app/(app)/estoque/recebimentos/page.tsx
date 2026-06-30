import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { loadTransferenciasAReceber, loadPedidosAReceber } from "../_data";
import { RecebimentosClient } from "./_client";

export default async function RecebimentosPage() {
  const ctx = await requireActiveTenant();
  const { aReceber, pedidos } = await withTenant(ctx, async () => {
    const activeSiteId = await getActiveSiteId();
    const [aReceber, pedidos] = await Promise.all([
      loadTransferenciasAReceber(activeSiteId),
      loadPedidosAReceber(activeSiteId),
    ]);
    return { aReceber, pedidos };
  });

  const pedidosSerial = pedidos.map((p) => ({
    ...p,
    previsaoEntrega: p.previsaoEntrega?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    enviadoEm: p.enviadoEm?.toISOString() ?? null,
  }));

  const transfersSerial = aReceber.map((t) => ({
    ...t,
    expedidoEm: t.expedidoEm?.toISOString() ?? null,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-ink">Recebimentos</h2>
        <p className="text-sm text-muted">
          Confira a mercadoria que chegou — pedidos de fornecedor e transferências em trânsito — e gere a entrada no estoque.
        </p>
      </div>
      <RecebimentosClient pedidos={pedidosSerial} transferencias={transfersSerial} />
    </div>
  );
}
