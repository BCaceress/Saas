import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { resolvePeriodo } from "@/lib/periodo";
import { brl } from "@/lib/utils";
import { KpiCard } from "@/components/charts/kpi-card";
import { ChartCard, ChartEmpty } from "@/components/charts/chart-card";
import { BarList } from "@/components/charts/bar-list";
import { consumoInsumos, rentabilidadeDrinks, type Range } from "../_data";
import { TabelaProducao } from "./tabela";
import { RelatorioShell } from "../_report-shell";

export default async function RelatorioProducao({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const ctx = await requireActiveTenant();
  const periodo = resolvePeriodo(await searchParams);
  const range: Range = { inicio: periodo.inicio, fim: periodo.fim };

  const d = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const [insumos, drinks] = await Promise.all([
      consumoInsumos(range, siteId),
      rentabilidadeDrinks(range, siteId),
    ]);
    return { insumos, drinks };
  });

  const custoInsumos = d.insumos.reduce((s, i) => s + i.custo, 0);
  const receitaDrinks = d.drinks.reduce((s, i) => s + i.receita, 0);
  const margemDrinks = d.drinks.reduce((s, i) => s + i.margem, 0);

  return (
    <RelatorioShell titulo="Produção e drinks" exportTipo="producao">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Margem dos drinks"
          value={brl(margemDrinks)}
          hint="receita − insumos"
          destaque
        />
        <KpiCard label="Receita de drinks" value={brl(receitaDrinks)} />
        <KpiCard label="Custo de insumos" value={brl(custoInsumos)} goodWhen="down" />
        <KpiCard label="Insumos consumidos" value={String(d.insumos.length)} />
      </div>

      <ChartCard title="Rentabilidade por drink" subtitle="Preço − custo dos insumos (via produção)">
        {d.drinks.length === 0 ? (
          <ChartEmpty mensagem="Nenhum personalizado vendido no período." />
        ) : (
          <TabelaProducao linhas={d.drinks} />
        )}
      </ChartCard>

      <ChartCard title="Consumo de insumos" subtitle="Custo consumido na produção">
        {d.insumos.length === 0 ? (
          <ChartEmpty />
        ) : (
          <BarList
            tone="accent"
            items={d.insumos
              .slice(0, 10)
              .map((i) => ({ label: i.nome, value: i.custo, sub: i.sku, display: brl(i.custo) }))}
          />
        )}
      </ChartCard>
    </RelatorioShell>
  );
}
