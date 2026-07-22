import { withTenant } from "@/lib/current-tenant";
import { requirePermissao } from "@/lib/guard";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";
import { AnalyticsSiteSelector } from "./_controls";

export default async function RelatoriosLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePermissao("relatorio.ver");
  const { sites, activeSiteId } = await withTenant(ctx, async () => {
    const [sites, activeSiteId] = await Promise.all([listSites(), getActiveSiteId()]);
    return { sites, activeSiteId };
  });
  const multiSite = (ctx.tenant.numPontos ?? 1) > 1 || sites.length > 1;

  return (
    <div className="space-y-6 pb-10">
      {/* Header: título + propósito. Sem abas — o hub é um ambiente único. */}
      <PageHeader
        title="Relatórios"
        icon={navIcon("/relatorios")}
        description="Descubra informações sobre seu negócio, gere relatórios, consulte documentos ou faça perguntas para a IA."
        innerClassName="max-w-none"
        actions={
          multiSite ? (
            <AnalyticsSiteSelector sites={sites} activeSiteId={activeSiteId} />
          ) : undefined
        }
      />

      {children}
    </div>
  );
}
