import Link from "next/link";
import { cookies } from "next/headers";
import { Sparkles } from "lucide-react";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { loadPedidosCompra, loadComprasFormOptions, loadTransferenciasAReceber } from "../estoque/_data";
import { SiteSelector } from "@/components/app/site-selector";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";
import { ComprasAcoes } from "./_acoes";
import { PurchaseOrdersClient, PO_VIEW_COOKIE, type PoView } from "./_po-client";

// ── Pedidos de Compra ──────────────────────────────────────────
// Acompanhamento dos pedidos já criados (status, entregas, recebimentos,
// histórico). Esta tela NÃO sugere compras — a inteligência de reposição
// vive exclusivamente em /compras/reposicao-inteligente.

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
    const [pedidos, formOptions, aReceber, sites] = await Promise.all([
      loadPedidosCompra(),
      loadComprasFormOptions(),
      loadTransferenciasAReceber(activeSiteId),
      listSites(),
    ]);
    return { pedidos, formOptions, aReceber, sites, activeSiteId };
  });

  // Último modo usado (lista/kanban) — lido no servidor para abrir já certo.
  const store = await cookies();
  const view: PoView = store.get(PO_VIEW_COOKIE)?.value === "kanban" ? "kanban" : "lista";

  const pedidosSerial = data.pedidos.map(serialPedido);
  const transfersSerial = data.aReceber.map((t) => ({
    ...t,
    expedidoEm: t.expedidoEm?.toISOString() ?? null,
  }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Pedidos de Compra"
        icon={navIcon("/compras")}
        description="Gerencie, acompanhe e receba pedidos enviados aos fornecedores."
        innerClassName="max-w-none"
        actions={
          <>
            <SiteSelector sites={data.sites} activeSiteId={data.activeSiteId} />
            {/* Sugestões/inteligência moram só na Reposição inteligente */}
            <Link
              href="/compras/reposicao-inteligente"
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
            >
              <Sparkles size={15} className="text-brand" />
              <span className="hidden sm:inline">Reposição inteligente</span>
            </Link>
            <ComprasAcoes formOptions={data.formOptions} empresa={ctx.tenant.nome} />
          </>
        }
      />
      <PurchaseOrdersClient
        pedidos={pedidosSerial}
        transferencias={transfersSerial}
        formOptions={data.formOptions}
        empresa={ctx.tenant.nome}
        initialView={view}
        initialQuery={sp.q}
      />
    </div>
  );
}
