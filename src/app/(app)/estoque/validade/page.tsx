import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { loadLotes } from "../_data";
import { ValidadeView } from "./_client";

export default async function ValidadePage() {
  const ctx = await requireActiveTenant();
  const alertaDias = ctx.tenant.validadeAlertaDias || 30;

  const { rows, siteId } = await withTenant(ctx, async () => {
    const sid = await getActiveSiteId();
    return { rows: await loadLotes(sid, { alertaDias }), siteId: sid };
  });

  return <ValidadeView rows={rows} alertaDias={alertaDias} siteId={siteId} />;
}
