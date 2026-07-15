import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { loadInventarios, loadInventarioCategorias } from "../_data";
import { InventarioClient } from "./_client";

export default async function InventarioPage() {
  const ctx = await requireActiveTenant();
  const { inventarios, sites, activeSiteId, categories } = await withTenant(ctx, async () => {
    const activeSiteId = await getActiveSiteId();
    const [inventarios, sites, categories] = await Promise.all([
      loadInventarios(activeSiteId),
      listSites(),
      loadInventarioCategorias(),
    ]);
    return {
      inventarios: inventarios.map((inv) => ({
        ...inv,
        dataProgramada: inv.dataProgramada.toISOString(),
        createdAt: inv.createdAt.toISOString(),
        iniciadoEm: inv.iniciadoEm?.toISOString() ?? null,
        fechadoEm: inv.fechadoEm?.toISOString() ?? null,
      })),
      sites,
      activeSiteId,
      categories,
    };
  });

  return (
    <InventarioClient
      inventarios={inventarios}
      sites={sites}
      activeSiteId={activeSiteId}
      categories={categories}
    />
  );
}
