import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { resolvePeriodo } from "@/lib/periodo";
import { KpiCard } from "@/components/charts/kpi-card";
import { ChartCard, ChartEmpty } from "@/components/charts/chart-card";
import { ParetoChart } from "@/components/charts/pareto-chart";
import { curvaABC, type Range } from "../_data";
import { TabelaABC } from "./tabela";
import { RelatorioShell } from "../_report-shell";

export default async function RelatorioABC({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const ctx = await requireActiveTenant();
  const periodo = resolvePeriodo(await searchParams);
  const range: Range = { inicio: periodo.inicio, fim: periodo.fim };

  const itens = await withTenant(ctx, async () =>
    curvaABC(range, await getActiveSiteId()),
  );

  const contagem = { A: 0, B: 0, C: 0 };
  for (const i of itens) contagem[i.classe]++;
  const fatA = itens.filter((i) => i.classe === "A").reduce((s, i) => s + i.receita, 0);
  const total = itens.reduce((s, i) => s + i.receita, 0);

  return (
    <RelatorioShell titulo="Curva ABC" exportTipo="abc">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Classe A"
          value={String(contagem.A)}
          hint={total > 0 ? `${Math.round((fatA / total) * 100)}% do faturamento` : undefined}
          destaque
        />
        <KpiCard label="Classe B" value={String(contagem.B)} />
        <KpiCard label="Classe C" value={String(contagem.C)} />
        <KpiCard label="Itens" value={String(itens.length)} />
      </div>

      <ChartCard
        title="Curva ABC"
        subtitle="Concentração do faturamento — barras por classe, linha = % acumulado"
      >
        {itens.length === 0 ? (
          <ChartEmpty />
        ) : (
          <ParetoChart
            itens={itens.map((i) => ({
              label: i.nome,
              value: i.receita,
              acumuladoPct: i.acumuladoPct,
              classe: i.classe,
            }))}
          />
        )}
      </ChartCard>

      <ChartCard title="Classificação" subtitle="A ≤ 80% · B ≤ 95% · C resto">
        {itens.length === 0 ? <ChartEmpty /> : <TabelaABC linhas={itens} />}
      </ChartCard>
    </RelatorioShell>
  );
}
