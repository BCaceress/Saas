import { requireFeature } from "@/lib/guard";
import { featureAtiva } from "@/lib/planos";
import { runWithTenant } from "@/lib/tenant-context";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { sessaoAtual, relatorioCaixa } from "@/lib/caixa";
import { listSitePaymentMethods } from "@/lib/vendas";
import { integracaoPdv } from "@/lib/pagamentos";
import { db } from "@/lib/prisma";
import { loadProdutosVenda } from "./_data";
import { PdvClient } from "./_client";

export default async function VendasPage() {
  const ctx = await requireFeature("pdv");

  return runWithTenant(ctx.tenant.id, async () => {
    const siteId = await getActiveSiteId();
    const [sites, produtos, sessao, metodos, integracao] = await Promise.all([
      listSites(),
      loadProdutosVenda(siteId),
      siteId ? sessaoAtual(ctx.tenant.id, siteId, ctx.user.id ?? "") : Promise.resolve(null),
      siteId ? listSitePaymentMethods(ctx.tenant.id, siteId) : Promise.resolve([]),
      siteId
        ? integracaoPdv(ctx.tenant.id, siteId)
        : Promise.resolve({ pixAutomatico: false, cartaoIntegrado: false, terminais: [] }),
    ]);

    // Só acompanhamos a nota quando ela realmente vai ser emitida — módulo
    // ligado, provedor ativo e emissão automática marcada.
    const cfgFiscal = featureAtiva(ctx.tenant, "fiscal")
      ? await db.fiscalConfig.findFirst({
          select: { ativo: true, emissaoAutomaticaNfce: true },
        })
      : null;
    const emiteNfce = Boolean(cfgFiscal?.ativo && cfgFiscal.emissaoAutomaticaNfce);

    const metodosAtivos = metodos.filter((m) => m.ativo).map((m) => m.metodo);
    const relatorio = sessao ? await relatorioCaixa(ctx.tenant.id, sessao.id) : null;
    const siteNome = sites.find((s) => s.id === siteId)?.nome ?? sites[0]?.nome ?? "";

    return (
      <PdvClient
        sites={sites}
        defaultSiteId={siteId}
        produtos={produtos}
        metodosAtivos={metodosAtivos}
        integracao={integracao}
        operador={ctx.user.name ?? ctx.user.email ?? "Operador"}
        emiteNfce={emiteNfce}
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
