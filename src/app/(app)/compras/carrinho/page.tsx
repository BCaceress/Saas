import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { loadCarrinho } from "../_catalogo/data";
import { CarrinhoCompras } from "./_client";

export default async function PedidosPage() {
  const ctx = await requireActiveTenant();

  const dados = await withTenant(ctx, async () => {
    const [grupos, sites, activeSiteId] = await Promise.all([
      loadCarrinho(ctx.user.id),
      listSites(),
      getActiveSiteId(),
    ]);
    return { grupos, sites, activeSiteId };
  });

  return (
    <CarrinhoCompras
      grupos={dados.grupos}
      sites={dados.sites.map((s) => ({ id: s.id, nome: s.nome }))}
      siteInicial={dados.activeSiteId ?? dados.sites[0]?.id ?? ""}
      podePedir={podeEmAlguma(ctx.acessos, "compras.pedir")}
    />
  );
}
