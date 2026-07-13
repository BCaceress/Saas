import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import {
  loadPedidosCompra,
  loadComprasFormOptions,
  loadTransferenciasAReceber,
  loadEntradasExtrato,
} from "../estoque/_data";
import { loadSugestoesReposicao } from "./_data";
import { SiteSelector } from "@/components/app/site-selector";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";
import { ComprasInbox } from "./_hub";
import { ComprasAcoes } from "./_acoes";

const serialPedido = <T extends { previsaoEntrega: Date | null; createdAt: Date; enviadoEm: Date | null }>(p: T) => ({
  ...p,
  previsaoEntrega: p.previsaoEntrega?.toISOString() ?? null,
  createdAt: p.createdAt.toISOString(),
  enviadoEm: p.enviadoEm?.toISOString() ?? null,
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
    const [sugestoes, pedidos, formOptions, aReceber, eventos, sites] = await Promise.all([
      loadSugestoesReposicao(activeSiteId),
      loadPedidosCompra(),
      loadComprasFormOptions(),
      loadTransferenciasAReceber(activeSiteId),
      loadEntradasExtrato(activeSiteId),
      listSites(),
    ]);
    return { sugestoes, pedidos, formOptions, aReceber, eventos, sites, activeSiteId };
  });

  const pedidosSerial = data.pedidos.map(serialPedido);
  const transfersSerial = data.aReceber.map((t) => ({
    ...t,
    expedidoEm: t.expedidoEm?.toISOString() ?? null,
  }));
  const eventosSerial = data.eventos.map((e) => ({
    ...e,
    data: e.data.toISOString(),
    pedidoCriadoEm: e.pedidoCriadoEm?.toISOString() ?? null,
    pedidoEnviadoEm: e.pedidoEnviadoEm?.toISOString() ?? null,
  }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Compras"
        icon={navIcon("/compras")}
        description="Saiba o que precisa comprar e acompanhe o que já está a caminho."
        innerClassName="max-w-none"
        actions={
          <>
            <SiteSelector sites={data.sites} activeSiteId={data.activeSiteId} />
            <ComprasAcoes eventos={eventosSerial} formOptions={data.formOptions} empresa={ctx.tenant.nome} />
          </>
        }
      />
      <ComprasInbox
        grupos={data.sugestoes}
        pedidos={pedidosSerial}
        transferencias={transfersSerial}
        eventos={eventosSerial}
        formOptions={data.formOptions}
        empresa={ctx.tenant.nome}
        initialQuery={sp.q}
      />
    </div>
  );
}
