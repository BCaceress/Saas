import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { loadCustomerRows, loadCouponCandidates } from "./_data";
import { ClientesClient } from "./_client";

export const metadata = { title: "Clientes — NoHub Market" };

export default async function ClientesPage() {
  const ctx = await requireActiveTenant();

  const data = await runWithTenant(ctx.tenant.id, async () => {
    const [rows, candidates] = await Promise.all([
      loadCustomerRows(),
      loadCouponCandidates(ctx.tenant.cupomDiasRisco),
    ]);
    return { rows, candidates };
  });

  return (
    <ClientesClient
      rows={data.rows}
      candidates={data.candidates}
      cupomAutomatico={ctx.tenant.cupomAutomatico}
      cupomDiasRisco={ctx.tenant.cupomDiasRisco}
    />
  );
}
