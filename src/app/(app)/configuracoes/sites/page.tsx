import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { SitesManager } from "./_client";

export default async function SitesPage() {
  const ctx = await requireActiveTenant();
  const sites = await runWithTenant(ctx.tenant.id, async () => {
    return await db.site.findMany({ orderBy: { createdAt: "asc" } });
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">Lojas e pontos</h1>
        <p className="text-sm text-muted">
          Lojas, pontos autônomos e centros de distribuição do tenant.
        </p>
      </div>
      <SitesManager
        sites={sites.map((s) => ({
          id: s.id,
          nome: s.nome,
          tipo: s.tipo,
          ativo: s.ativo,
        }))}
      />
    </div>
  );
}
