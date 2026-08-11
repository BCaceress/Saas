import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { can } from "@/lib/permissoes";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { loadPedidosAReceber } from "@/app/(app)/estoque/_data";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { ReceberClient } from "./_client";

/** Pedidos de compra esperando conferência na porta. */
export default async function ReceberPage() {
  const ctx = await requirePermissaoMobile("compras.receber");

  const { pedidos, multiSite } = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const [pedidos, sites] = await Promise.all([loadPedidosAReceber(siteId), listSites()]);
    return { pedidos, multiSite: sites.length > 1 };
  });

  return (
    <>
      <MobilePageHeader titulo="Receber" descricao="Conferir e dar entrada." />

      <ReceberClient
        multiSite={multiSite}
        pedidos={pedidos.map((p) => ({
          id: p.id,
          numero: p.numero,
          status: p.status,
          supplierNome: p.supplierNome,
          supplierLogoUrl: p.supplierLogoUrl,
          siteNome: p.siteNome,
          totalItems: p.totalItems,
          valorTotal: p.valorTotal,
          previsaoEntrega: p.previsaoEntrega?.toISOString() ?? null,
          // Permissão é POR LOJA: quem confere no depósito pode não mexer no
          // pedido da outra unidade. Esconder o botão é cosmético (a action
          // valida de novo), mas evita oferecer o que vai dar erro.
          podePedir: can(ctx.acessos, "compras.pedir", p.siteId),
        }))}
      />
    </>
  );
}
