import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { loadEntradasExtrato } from "../_data";
import { ExtratoEntradas } from "./_client";

export default async function EntradasPage() {
  const ctx = await requireActiveTenant();
  const eventos = await withTenant(ctx, async () => {
    const sid = await getActiveSiteId();
    return loadEntradasExtrato(sid);
  });

  const serial = eventos.map((e) => ({ ...e, data: e.data.toISOString() }));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Extrato de tudo que entrou no estoque — compras, transferências, ajustes e devoluções.
        Para lançar uma entrada manual, use o botão <strong className="text-ink">Entrada</strong> no topo.
      </p>
      <ExtratoEntradas eventos={serial} />
    </div>
  );
}
