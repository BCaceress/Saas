import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { db } from "@/lib/prisma";
import { AjustesForm } from "./_client";

export default async function AjustesPage() {
  const ctx = await requireActiveTenant();
  const [siteId, sites, products] = await withTenant(ctx, async () => {
    const [sid, ss, ps] = await Promise.all([
      getActiveSiteId(),
      listSites(),
      db.product.findMany({
        where: { ativo: true },
        orderBy: { nome: "asc" },
        select: { id: true, nome: true, sku: true, unidadeBase: true, fracionavel: true },
      }),
    ]);
    return [sid, ss, ps] as const;
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-ink">Ajustes e perdas</h2>
        <p className="text-sm text-muted">Corrija saldos por contagem física ou registre quebras e vencimentos.</p>
      </div>
      <AjustesForm sites={sites} defaultSiteId={siteId} products={products} />
    </div>
  );
}
