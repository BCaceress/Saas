import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { loadPersonalizados } from "../_data";
import { ProducaoForm } from "./_client";

export default async function ProducaoPage() {
  const ctx = await requireActiveTenant();
  const [siteId, sites, personalizados] = await withTenant(ctx, async () => {
    const [sid, ss, ps] = await Promise.all([getActiveSiteId(), listSites(), loadPersonalizados()]);
    return [sid, ss, ps] as const;
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-ink">Registrar produção</h2>
        <p className="text-sm text-muted">
          Consome insumos do estoque via ficha técnica. A lógica de saldo aberto roda automaticamente.
        </p>
      </div>
      <ProducaoForm sites={sites} defaultSiteId={siteId} personalizados={personalizados} />
    </div>
  );
}
