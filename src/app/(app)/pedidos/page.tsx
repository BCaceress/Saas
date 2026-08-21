import { cookies } from "next/headers";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { loadPedidosCompra, loadTransferenciasAReceber } from "../estoque/_data";
import { SiteSelector } from "@/components/app/site-selector";
import { PageHeader } from "@/components/app/page-header";
import { navIcon, navDescricao } from "@/components/app/nav-config";
import { ComprasAcoes } from "./_acoes";
import { NovoPedidoProvider } from "./_novo-pedido";
import { FormOptionsProvider } from "./_form-options";
import { PurchaseOrdersClient, PO_VIEW_COOKIE, type PoView } from "./_po-client";

// ── Pedidos de Compra ──────────────────────────────────────────
// Acompanhamento dos pedidos já criados (status, entregas, recebimentos,
// histórico). Esta tela NÃO sugere compras — a inteligência de reposição
// vive exclusivamente em /cotacoes/reposicao-inteligente.

const serialPedido = <
  T extends {
    previsaoEntrega: Date | null;
    createdAt: Date;
    updatedAt: Date;
    enviadoEm: Date | null;
    confirmadoEm: Date | null;
    emTransitoEm: Date | null;
    recebidoEm: Date | null;
    canceladoEm: Date | null;
  },
>(p: T) => ({
  ...p,
  previsaoEntrega: p.previsaoEntrega?.toISOString() ?? null,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
  enviadoEm: p.enviadoEm?.toISOString() ?? null,
  confirmadoEm: p.confirmadoEm?.toISOString() ?? null,
  emTransitoEm: p.emTransitoEm?.toISOString() ?? null,
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
    const [pedidos, aReceber, sites] = await Promise.all([
      loadPedidosCompra(),
      loadTransferenciasAReceber(activeSiteId),
      listSites(),
    ]);
    return { pedidos, aReceber, sites, activeSiteId };
  });

  // Último modo usado (lista/kanban) — lido no servidor para abrir já certo.
  const store = await cookies();
  const view: PoView = store.get(PO_VIEW_COOKIE)?.value === "kanban" ? "kanban" : "lista";

  const pedidosSerial = data.pedidos.map(serialPedido);
  const transfersSerial = data.aReceber.map((t) => ({
    ...t,
    expedidoEm: t.expedidoEm?.toISOString() ?? null,
  }));

  const descricao = navDescricao("/pedidos");
  return (
    <FormOptionsProvider>
      <NovoPedidoProvider empresa={ctx.tenant.nome}>
        <div className="flex flex-col gap-5">
          <PageHeader
            title="Pedidos de Compra"
            icon={navIcon("/pedidos")}
            description={descricao}
            innerClassName="max-w-none"
            actions={
              /* Receber mercadoria é permissão à parte de "ver pedidos": quem
                 só acompanha compra não confere carga na porta. */
              <ComprasAcoes podeReceber={podeEmAlguma(ctx.acessos, "compras.receber")} />
            }
          >
            <div className="flex justify-end print:hidden">
              <SiteSelector sites={data.sites} activeSiteId={data.activeSiteId} />
            </div>
          </PageHeader>
          <PurchaseOrdersClient
            pedidos={pedidosSerial}
            transferencias={transfersSerial}
            empresa={ctx.tenant.nome}
            initialView={view}
            initialQuery={sp.q}
          />
        </div>
      </NovoPedidoProvider>
    </FormOptionsProvider>
  );
}
