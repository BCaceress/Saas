import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { sessaoAtual, relatorioCaixa } from "@/lib/caixa";
import { PageHeader } from "@/components/app/page-header";
import { CaixaClient } from "./_client";

export default async function CaixaPage() {
  const ctx = await requireActiveTenant();

  return runWithTenant(ctx.tenant.id, async () => {
    const siteId = await getActiveSiteId();
    const [sites, sessao] = await Promise.all([
      listSites(),
      siteId ? sessaoAtual(ctx.tenant.id, siteId, ctx.user.id ?? "") : Promise.resolve(null),
    ]);
    const relatorio = sessao ? await relatorioCaixa(ctx.tenant.id, sessao.id) : null;

    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          eyebrow="PDV"
          title="Caixa"
          description="Abertura, sangria, suprimento e fechamento do turno."
          backHref="/vendas"
        />
        <CaixaClient
          sites={sites}
          defaultSiteId={siteId}
          aberta={
            sessao
              ? { id: sessao.id, abertaEm: sessao.abertaEm, valorAbertura: Number(sessao.valorAbertura) }
              : null
          }
          relatorio={relatorio}
        />
      </div>
    );
  });
}
