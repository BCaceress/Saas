import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { resolvePeriodo, variacao, fmtData } from "@/lib/periodo";
import { brl } from "@/lib/utils";
import { KpiCard } from "@/components/charts/kpi-card";
import { ChartCard, ChartEmpty } from "@/components/charts/chart-card";
import { LineChart } from "@/components/charts/line-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import {
  resumoVendas,
  vendasPorDia,
  vendasPorHora,
  vendasPorCategoria,
  rankingProdutos,
  type Range,
} from "../_data";
import { TabelaVendas } from "./tabela";

export default async function RelatorioVendas({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireActiveTenant();
  const periodo = resolvePeriodo(await searchParams);
  const range: Range = { inicio: periodo.inicio, fim: periodo.fim };
  const prev: Range = { inicio: periodo.prevInicio, fim: periodo.prevFim };

  const d = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const [resumo, resumoPrev, tendencia, porHora, categorias, ranking] = await Promise.all([
      resumoVendas(range, siteId),
      resumoVendas(prev, siteId),
      vendasPorDia(range, siteId),
      vendasPorHora(range, siteId),
      vendasPorCategoria(range, siteId),
      rankingProdutos(range, siteId),
    ]);
    return { resumo, resumoPrev, tendencia, porHora, categorias, ranking };
  });

  const vazio = d.resumo.numVendas === 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Faturamento" value={brl(d.resumo.faturamento)} delta={variacao(d.resumo.faturamento, d.resumoPrev.faturamento)} destaque />
        <KpiCard label="Nº de vendas" value={String(d.resumo.numVendas)} delta={variacao(d.resumo.numVendas, d.resumoPrev.numVendas)} />
        <KpiCard label="Ticket médio" value={brl(d.resumo.ticket)} delta={variacao(d.resumo.ticket, d.resumoPrev.ticket)} />
        <KpiCard label="CMV" value={brl(d.resumo.cmv)} hint="custo da venda" goodWhen="down" />
      </div>

      <ChartCard title="Faturamento por dia" subtitle={periodo.label}>
        {vazio ? <ChartEmpty /> : <LineChart pontos={d.tendencia.map((p) => ({ data: fmtData(new Date(p.data)), valor: p.valor }))} />}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Por hora do dia" subtitle="Quando vende mais">
          {vazio ? <ChartEmpty /> : <LineChart pontos={d.porHora.map((p) => ({ data: p.data, valor: p.valor }))} altura={160} />}
        </ChartCard>
        <ChartCard title="Por categoria" subtitle="Composição do faturamento">
          {d.categorias.length === 0 ? <ChartEmpty /> : <DonutChart fatias={d.categorias.slice(0, 6).map((c) => ({ label: c.categoria, value: c.receita, display: brl(c.receita) }))} />}
        </ChartCard>
      </div>

      <ChartCard title="Produtos vendidos" subtitle={`${d.ranking.length} itens no período`}>
        {d.ranking.length === 0 ? <ChartEmpty /> : <TabelaVendas linhas={d.ranking} />}
      </ChartCard>
    </div>
  );
}
