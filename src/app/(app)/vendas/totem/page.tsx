import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { getActiveSiteId } from "@/lib/sites";
import { listSitePaymentMethods } from "@/lib/vendas";
import { loadProdutosVenda } from "../_data";
import { TotemClient } from "./_client";

export default async function TotemPage() {
  const ctx = await requireActiveTenant();

  return runWithTenant(ctx.tenant.id, async () => {
    const siteId = await getActiveSiteId();
    const [produtos, metodos] = await Promise.all([
      loadProdutosVenda(siteId),
      siteId ? listSitePaymentMethods(ctx.tenant.id, siteId) : Promise.resolve([]),
    ]);
    const metodosAtivos = metodos.filter((m) => m.ativo).map((m) => m.metodo);

    return (
      <TotemClient
        siteId={siteId}
        produtos={produtos}
        metodosAtivos={metodosAtivos}
        tenantNome={ctx.tenant.nome}
      />
    );
  });
}
