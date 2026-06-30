import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { resolvePeriodo, variacao } from "@/lib/periodo";
import { brl } from "@/lib/utils";
import { KpiCard } from "@/components/charts/kpi-card";
import { ChartCard, ChartEmpty } from "@/components/charts/chart-card";
import { BarList } from "@/components/charts/bar-list";
import { resumoVendas, rankingProdutos, type Range } from "../_data";
import { TabelaMargem } from "./tabela";

export default async function RelatorioMargem({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireActiveTenant();
  const periodo = resolvePeriodo(await searchParams);
  const range: Range = { inicio: periodo.inicio, fim: periodo.fim };
  const prev: Range = { inicio: periodo.prevInicio, fim: periodo.prevFim };

  const d = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const [resumo, resumoPrev, ranking] = await Promise.all([
      resumoVendas(range, siteId),
      resumoVendas(prev, siteId),
      rankingProdutos(range, siteId),
    ]);
    return { resumo, resumoPrev, ranking };
  });

  const comCusto = d.ranking.filter((p) => p.custo > 0);
  const topMargem = [...comCusto].sort((a, b) => b.margem - a.margem);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Margem bruta" value={brl(d.resumo.margemBruta)} delta={variacao(d.resumo.margemBruta, d.resumoPrev.margemBruta)} destaque />
        <KpiCard label="Margem %" value={`${Math.round(d.resumo.margemPct)}%`} hint="da receita" />
        <KpiCard label="Faturamento" value={brl(d.resumo.faturamento)} delta={variacao(d.resumo.faturamento, d.resumoPrev.faturamento)} />
        <KpiCard label="CMV" value={brl(d.resumo.cmv)} goodWhen="down" />
      </div>

      <ChartCard title="Maiores margens" subtitle="Receita − custo, por produto">
        {topMargem.length === 0 ? (
          <ChartEmpty mensagem="Sem custo médio cadastrado para calcular margem." />
        ) : (
          <BarList tone="accent" items={topMargem.slice(0, 8).map((p) => ({ label: p.nome, value: p.margem, sub: `${Math.round(p.margemPct)}%`, display: brl(p.margem) }))} />
        )}
      </ChartCard>

      <ChartCard title="Margem por produto" subtitle={`${d.ranking.length} itens`}>
        {d.ranking.length === 0 ? <ChartEmpty /> : <TabelaMargem linhas={d.ranking} />}
      </ChartCard>
    </div>
  );
}
