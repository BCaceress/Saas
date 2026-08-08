import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { PedidoClient } from "./_client";

/**
 * Pedido de compra montado de pé, na frente da prateleira.
 *
 * É o oposto da tela de reposição do desktop: lá o sistema propõe uma lista e a
 * pessoa revisa; aqui a pessoa aponta para o buraco na gôndola e o sistema
 * responde quanto falta. As duas terminam no mesmo `criarPedidoCompra`.
 */
export default async function PedidoMobilePage() {
  const ctx = await requirePermissaoMobile("compras.pedir");

  const { sites, siteAtivo } = await withTenant(ctx, async () => {
    const [sites, siteAtivo] = await Promise.all([listSites(), getActiveSiteId()]);
    return { sites: sites.map((s) => ({ id: s.id, nome: s.nome })), siteAtivo };
  });

  return (
    <>
      <MobilePageHeader
        titulo="Pedido de compra"
        descricao="Bipe o que está faltando."
        voltar="/m/mais"
      />
      <PedidoClient sites={sites} siteAtivo={siteAtivo} />
    </>
  );
}
