import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { loadFornecedores } from "./_data";
import { FornecedoresManager } from "./_client";

export default async function FornecedoresPage() {
  const ctx = await requireActiveTenant();

  const suppliers = await runWithTenant(ctx.tenant.id, () => loadFornecedores());

  return (
    <div className="flex flex-col gap-5">
      <FornecedoresManager suppliers={suppliers} />
    </div>
  );
}
