import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { PageHeader } from "@/components/app/page-header";
import { RelatoriosFiltros, RelatoriosTabs } from "./_controls";

export default async function RelatoriosLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireActiveTenant();
  const { sites, activeSiteId } = await withTenant(ctx, async () => {
    const [sites, activeSiteId] = await Promise.all([listSites(), getActiveSiteId()]);
    return { sites, activeSiteId };
  });
  const multiSite = (ctx.tenant.numPontos ?? 1) > 1 || sites.length > 1;

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="Relatórios"
        eyebrow="Análise"
        description="Vendas, margem, estoque e operação — recortados por período e site."
        innerClassName="max-w-none"
        actions={<RelatoriosFiltros sites={sites} activeSiteId={activeSiteId} multiSite={multiSite} />}
      >
        <RelatoriosTabs />
      </PageHeader>
      {children}
    </div>
  );
}
