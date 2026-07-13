import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { sessaoAtual, relatorioCaixa } from "@/lib/caixa";
import { listSitePaymentMethods } from "@/lib/vendas";
import { loadProdutosVenda } from "./_data";
import { PdvClient } from "./_client";

export default async function VendasPage() {
  const ctx = await requireActiveTenant();

  return runWithTenant(ctx.tenant.id, async () => {
    const siteId = await getActiveSiteId();
    const [sites, produtos, sessao, metodos] = await Promise.all([
      listSites(),
      loadProdutosVenda(siteId),
      siteId ? sessaoAtual(ctx.tenant.id, siteId, ctx.user.id ?? "") : Promise.resolve(null),
      siteId ? listSitePaymentMethods(ctx.tenant.id, siteId) : Promise.resolve([]),
    ]);

    const metodosAtivos = metodos.filter((m) => m.ativo).map((m) => m.metodo);
    const relatorio = sessao ? await relatorioCaixa(ctx.tenant.id, sessao.id) : null;
    const siteNome = sites.find((s) => s.id === siteId)?.nome ?? sites[0]?.nome ?? "";

    return (
      <PdvClient
        sites={sites}
        defaultSiteId={siteId}
        produtos={produtos}
        metodosAtivos={metodosAtivos}
        operador={ctx.user.name ?? ctx.user.email ?? "Operador"}
        caixa={
          sessao
            ? {
                id: sessao.id,
                siteNome,
                abertaEm: sessao.abertaEm,
                valorAbertura: Number(sessao.valorAbertura),
                relatorio,
              }
            : null
        }
        fundoTrocoPadrao={
          ctx.tenant.caixaFundoTroco != null ? Number(ctx.tenant.caixaFundoTroco) : null
        }
        limiteGaveta={
          ctx.tenant.caixaLimiteGaveta != null ? Number(ctx.tenant.caixaLimiteGaveta) : null
        }
      />
    );
  });
}
