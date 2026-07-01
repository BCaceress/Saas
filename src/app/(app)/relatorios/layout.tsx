import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { AnalyticsNav, AnalyticsSiteSelector } from "./_controls";

export default async function RelatoriosLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireActiveTenant();
  const { sites, activeSiteId } = await withTenant(ctx, async () => {
    const [sites, activeSiteId] = await Promise.all([listSites(), getActiveSiteId()]);
    return { sites, activeSiteId };
  });
  const multiSite = (ctx.tenant.numPontos ?? 1) > 1 || sites.length > 1;

  return (
    <div className="space-y-6 pb-10">
      {/* Header: título à esquerda, abas à direita */}
      <header className="border-b border-line pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight text-black dark:text-ink">
            Análises
          </h1>
          <div className="flex items-center gap-2">
            <AnalyticsNav />
            {multiSite && (
              <span className="ml-1 border-l border-line pl-3">
                <AnalyticsSiteSelector sites={sites} activeSiteId={activeSiteId} />
              </span>
            )}
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
