import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { loadMovimentacoes } from "../_data";
import { MovimentacoesView } from "./_client";

export default async function MovimentacoesPage() {
  const ctx = await requireActiveTenant();
  const rows = await withTenant(ctx, async () => {
    const sid = await getActiveSiteId();
    return loadMovimentacoes(sid, { limit: 500 });
  });

  return <MovimentacoesView rows={rows} />;
}
