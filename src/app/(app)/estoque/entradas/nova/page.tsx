import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getOrCreateDefaultSite } from "@/lib/sites";
import { loadEntradaFormOptions } from "../../_data";
import { NovaEntradaForm } from "./_client";

export default async function NovaEntradaPage() {
  const ctx = await requireActiveTenant();
  const opts = await withTenant(ctx, async (c) => {
    // Garante ao menos um local antes de carregar as opções do formulário.
    await getOrCreateDefaultSite(c.tenant.id);
    return loadEntradaFormOptions();
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-ink">Registrar entrada</h2>
        <p className="text-sm text-muted">Entrada manual com conversão de embalagem.</p>
      </div>
      <NovaEntradaForm {...opts} motivo="COMPRA_SEM_PEDIDO" />
    </div>
  );
}
