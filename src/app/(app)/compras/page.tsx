import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import {
  loadPedidosCompra,
  loadComprasFormOptions,
  loadPedidosAReceber,
  loadTransferenciasAReceber,
  loadEntradasExtrato,
} from "../estoque/_data";
import { loadSugestoesReposicao } from "./_data";
import { SiteSelector } from "@/components/app/site-selector";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";
import { ComprasHub } from "./_hub";

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
    const [sugestoes, pedidos, formOptions, aReceber, pedidosReceber, eventos, sites] = await Promise.all([
      loadSugestoesReposicao(activeSiteId),
      loadPedidosCompra(),
      loadComprasFormOptions(),
      loadTransferenciasAReceber(activeSiteId),
      loadPedidosAReceber(activeSiteId),
      loadEntradasExtrato(activeSiteId),
      listSites(),
    ]);
    return { sugestoes, pedidos, formOptions, aReceber, pedidosReceber, eventos, sites, activeSiteId };
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
      <PageHeader
        title="Compras"
        icon={navIcon("/compras")}
        description="O sistema sugere o que repor — você revisa e envia ao fornecedor."
        innerClassName="max-w-none"
        actions={<SiteSelector sites={data.sites} activeSiteId={data.activeSiteId} />}
      />
      <ComprasHub
        reposicao={{ grupos: data.sugestoes, siteId: data.activeSiteId, empresa: ctx.tenant.nome }}
        compras={{ pedidos: pedidosSerial, formOptions: data.formOptions }}
        receber={{ pedidos: pedidosReceberSerial, transferencias: transfersSerial }}
        eventos={eventosSerial}
        initialTab={sp.tab === "pedidos" ? "pedidos" : undefined}
        initialQuery={sp.q}
      />
    </div>
  );
}
