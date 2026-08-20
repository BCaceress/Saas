import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { getActiveSiteId } from "@/lib/sites";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { PageHeader } from "@/components/app/page-header";
import { navIcon, navTabs } from "@/components/app/nav-config";
import { loadCotacoes } from "./_compra-data";
import { loadSugestoesReposicao } from "./_data";
import { ListaCotacoes } from "./_client";

export default async function CotacoesPage() {
  const ctx = await requireActiveTenant();
  const { linhas, resumo, produtosSugeridos } = await withTenant(ctx, async () => {
    const activeSiteId = await getActiveSiteId();
    const policy = policyDoTenant(ctx.tenant);
    const [lista, sugestoes] = await Promise.all([
      loadCotacoes(),
      loadSugestoesReposicao(activeSiteId, policy),
    ]);
    const produtosSugeridos = sugestoes.grupos.reduce((acc, g) => acc + g.itens.length, 0);
    return { ...lista, produtosSugeridos };
  });

  const descricao = navTabs("/cotacoes").find((a) => a.href === "/cotacoes")?.descricao;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Cotações"
        icon={navIcon("/cotacoes")}
        description={descricao}
        innerClassName="max-w-none"
      />
      <ListaCotacoes
        linhas={linhas}
        resumo={resumo}
        produtosSugeridos={produtosSugeridos}
        podePedir={podeEmAlguma(ctx.acessos, "compras.pedir")}
      />
    </div>
  );
}
