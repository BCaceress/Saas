import { Sparkles } from "lucide-react";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { loadSugestoesReposicao } from "../_data";
import { PageHeader } from "@/components/app/page-header";
import { ReposicaoInteligenteClient } from "./_client";

// Assistente de compras: o sistema analisa estoque, consumo e
// fornecedores e o operador só revisa, ajusta e aprova. Cada
// fornecedor selecionado vira um pedido independente.

export default async function ReposicaoInteligentePage() {
  const ctx = await requireActiveTenant();
  const data = await withTenant(ctx, async () => {
    const activeSiteId = await getActiveSiteId();
    const sugestoes = await loadSugestoesReposicao(activeSiteId);
    return { sugestoes, activeSiteId };
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Reposição inteligente"
        icon={Sparkles}
        backHref="/compras"
        description="Revise as sugestões de compra e aprove a criação dos pedidos — um por fornecedor."
        innerClassName="max-w-none"
      />
      <ReposicaoInteligenteClient grupos={data.sugestoes} siteId={data.activeSiteId} empresa={ctx.tenant.nome} />
    </div>
  );
}
