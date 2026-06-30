import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { loadInventarios } from "../_data";
import { InventarioClient } from "./_client";

export default async function InventarioPage() {
  const ctx = await requireActiveTenant();
  const { inventarios, sites, activeSiteId } = await withTenant(ctx, async () => {
    const activeSiteId = await getActiveSiteId();
    const [inventarios, sites] = await Promise.all([
      loadInventarios(activeSiteId),
      listSites(),
    ]);
    return { inventarios, sites, activeSiteId };
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-ink">Inventário</h2>
        <p className="text-sm text-muted">
          Conte o estoque físico e ajuste o sistema pela diferença. A divergência vira um
          lançamento de ajuste no razão.
        </p>
      </div>
      <InventarioClient inventarios={inventarios} sites={sites} activeSiteId={activeSiteId} />
    </div>
  );
}
