import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { loadPedidosCompra, loadComprasFormOptions, loadTransferenciasAReceber } from "../estoque/_data";
import { loadSugestoesReposicao } from "./_data";
import { SiteSelector } from "@/components/app/site-selector";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";
import { ComprasInbox } from "./_hub";
import { ComprasAcoes } from "./_acoes";
import { HistoricoComprasProvider } from "./_historico-compras";

const serialPedido = <
  T extends { previsaoEntrega: Date | null; createdAt: Date; enviadoEm: Date | null; recebidoEm: Date | null; canceladoEm: Date | null },
>(p: T) => ({
  ...p,
  previsaoEntrega: p.previsaoEntrega?.toISOString() ?? null,
  createdAt: p.createdAt.toISOString(),
  enviadoEm: p.enviadoEm?.toISOString() ?? null,
  recebidoEm: p.recebidoEm?.toISOString() ?? null,
  canceladoEm: p.canceladoEm?.toISOString() ?? null,
});

export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const ctx = await requireActiveTenant();
  const sp = await searchParams;
  const data = await withTenant(ctx, async () => {
    const activeSiteId = await getActiveSiteId();
    const [sugestoes, pedidos, formOptions, aReceber, sites] = await Promise.all([
      loadSugestoesReposicao(activeSiteId),
      loadPedidosCompra(),
      loadComprasFormOptions(),
      loadTransferenciasAReceber(activeSiteId),
      listSites(),
    ]);
    return { sugestoes, pedidos, formOptions, aReceber, sites, activeSiteId };
  });

  const pedidosSerial = data.pedidos.map(serialPedido);
  const transfersSerial = data.aReceber.map((t) => ({
    ...t,
    expedidoEm: t.expedidoEm?.toISOString() ?? null,
  }));

  return (
    <HistoricoComprasProvider pedidos={pedidosSerial} formOptions={data.formOptions} empresa={ctx.tenant.nome}>
      <div className="flex flex-col gap-5">
        <PageHeader
          title="Reposições"
          icon={navIcon("/compras")}
          description="Gerencie reposições, pedidos e recebimentos."
          innerClassName="max-w-none"
          actions={
            <>
              <SiteSelector sites={data.sites} activeSiteId={data.activeSiteId} />
              <ComprasAcoes formOptions={data.formOptions} empresa={ctx.tenant.nome} />
            </>
          }
        />
        <ComprasInbox
          grupos={data.sugestoes}
          pedidos={pedidosSerial}
          transferencias={transfersSerial}
          formOptions={data.formOptions}
          empresa={ctx.tenant.nome}
          initialQuery={sp.q}
        />
      </div>
    </HistoricoComprasProvider>
  );
}
