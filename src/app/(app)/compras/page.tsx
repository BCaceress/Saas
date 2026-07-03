import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import {
  loadPedidosCompra,
  loadComprasFormOptions,
  loadPedidosAReceber,
  loadTransferenciasAReceber,
  loadEntradasExtrato,
} from "../estoque/_data";
import { SiteSelector } from "@/components/app/site-selector";
import { ComprasHub } from "./_hub";

const serialPedido = <T extends { previsaoEntrega: Date | null; createdAt: Date; enviadoEm: Date | null }>(p: T) => ({
  ...p,
  previsaoEntrega: p.previsaoEntrega?.toISOString() ?? null,
  createdAt: p.createdAt.toISOString(),
  enviadoEm: p.enviadoEm?.toISOString() ?? null,
});

export default async function ComprasPage() {
  const ctx = await requireActiveTenant();
  const data = await withTenant(ctx, async () => {
    const activeSiteId = await getActiveSiteId();
    const [pedidos, formOptions, aReceber, pedidosReceber, eventos, sites] = await Promise.all([
      loadPedidosCompra(),
      loadComprasFormOptions(),
      loadTransferenciasAReceber(activeSiteId),
      loadPedidosAReceber(activeSiteId),
      loadEntradasExtrato(activeSiteId),
      listSites(),
    ]);
    return { pedidos, formOptions, aReceber, pedidosReceber, eventos, sites, activeSiteId };
  });

  const pedidosSerial = data.pedidos.map(serialPedido);
  const pedidosReceberSerial = data.pedidosReceber.map(serialPedido);
  const transfersSerial = data.aReceber.map((t) => ({
    ...t,
    expedidoEm: t.expedidoEm?.toISOString() ?? null,
  }));
  const eventosSerial = data.eventos.map((e) => ({ ...e, data: e.data.toISOString() }));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Compras</h1>
          <p className="text-sm text-muted">
            Do pedido ao fornecedor até a entrada no estoque — pedidos, recebimentos e histórico.
          </p>
        </div>
        <SiteSelector sites={data.sites} activeSiteId={data.activeSiteId} />
      </div>
      <ComprasHub
        compras={{ pedidos: pedidosSerial, formOptions: data.formOptions }}
        receber={{ pedidos: pedidosReceberSerial, transferencias: transfersSerial }}
        eventos={eventosSerial}
      />
    </div>
  );
}
