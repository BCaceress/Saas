import { Sparkles } from "lucide-react";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { loadSugestoesReposicao } from "../_data";
import { PageHeader } from "@/components/app/page-header";
import { ReposicaoInteligenteClient } from "./_client";
import { chaveEscolha, lerEscolha, policyDaEscolha, type Params } from "./_url";

// Assistente de compras: o sistema analisa estoque, consumo e
// fornecedores e o operador só revisa, ajusta e aprova. Cada
// fornecedor selecionado vira um pedido independente.
//
// A base da conta vem da URL (`?base=movimentacao&dias=15`): a estratégia da
// empresa é o padrão, e o operador troca para "saiu isso em N dias, tenho
// tanto, compro a diferença" sem mexer em Configurações.

export default async function ReposicaoInteligentePage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const sp = await searchParams;
  const escolha = lerEscolha(sp);
  const ctx = await requireActiveTenant();
  const policyEmpresa = policyDoTenant(ctx.tenant);
  const policy = policyDaEscolha(policyEmpresa, escolha);

  const data = await withTenant(ctx, async () => {
    const activeSiteId = await getActiveSiteId();
    const sugestoes = await loadSugestoesReposicao(activeSiteId, policy, escolha.base);
    return { sugestoes, activeSiteId };
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Reposição inteligente"
        icon={Sparkles}
        backHref="/pedidos"
        description="Revise as sugestões de compra e aprove a criação dos pedidos — um por fornecedor."
        innerClassName="max-w-none"
      />
      <ReposicaoInteligenteClient
        /* Trocar a base refaz a lista: a revisão anterior não vale mais. */
        key={chaveEscolha(escolha)}
        grupos={data.sugestoes.grupos}
        policy={data.sugestoes.policy}
        policyEmpresa={policyEmpresa}
        escolha={escolha}
        aprendendo={data.sugestoes.aprendendo}
        siteId={data.activeSiteId}
        empresa={ctx.tenant.nome}
      />
    </div>
  );
}
