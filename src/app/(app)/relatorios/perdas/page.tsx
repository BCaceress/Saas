import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { resolvePeriodo, variacao } from "@/lib/periodo";
import { brl } from "@/lib/utils";
import { KpiCard } from "@/components/charts/kpi-card";
import { ChartCard, ChartEmpty } from "@/components/charts/chart-card";
import { BarList } from "@/components/charts/bar-list";
import { perdas, type Range } from "../_data";
import { TabelaPerdas } from "./tabela";
import { RelatorioShell } from "../_report-shell";

export default async function RelatorioPerdas({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const ctx = await requireActiveTenant();
  const periodo = resolvePeriodo(await searchParams);
  const range: Range = { inicio: periodo.inicio, fim: periodo.fim };
  const prev: Range = { inicio: periodo.prevInicio, fim: periodo.prevFim };

  const d = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const [atual, anterior] = await Promise.all([perdas(range, siteId), perdas(prev, siteId)]);
    return { atual, anterior };
  });

  return (
    <RelatorioShell titulo="Perdas e quebras" exportTipo="perdas">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Perda no período"
          value={brl(d.atual.total)}
          delta={variacao(d.atual.total, d.anterior.total)}
          goodWhen="down"
          destaque
        />
        <KpiCard label="Itens com perda" value={String(d.atual.itens.length)} goodWhen="down" />
      </div>

      <ChartCard title="Onde mais se perde" subtitle="Custo da perda por produto">
        {d.atual.itens.length === 0 ? (
          <ChartEmpty mensagem="Nenhuma perda registrada no período." />
        ) : (
          <BarList
            tone="danger"
            items={d.atual.itens
              .slice(0, 10)
              .map((p) => ({ label: p.nome, value: p.custo, sub: p.sku, display: brl(p.custo) }))}
          />
        )}
      </ChartCard>

      <ChartCard title="Perdas detalhadas" subtitle={periodo.label}>
        {d.atual.itens.length === 0 ? (
          <ChartEmpty mensagem="Sem perdas no período." />
        ) : (
          <TabelaPerdas linhas={d.atual.itens} />
        )}
      </ChartCard>
    </RelatorioShell>
  );
}
