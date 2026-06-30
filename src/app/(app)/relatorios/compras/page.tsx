import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { resolvePeriodo } from "@/lib/periodo";
import { brl } from "@/lib/utils";
import { KpiCard } from "@/components/charts/kpi-card";
import { ChartCard, ChartEmpty } from "@/components/charts/chart-card";
import { BarList } from "@/components/charts/bar-list";
import { comprasPorFornecedor, comprasPorProduto, type Range } from "../_data";
import { TabelaCompras } from "./tabela";

export default async function RelatorioCompras({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireActiveTenant();
  const periodo = resolvePeriodo(await searchParams);
  const range: Range = { inicio: periodo.inicio, fim: periodo.fim };

  const d = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const [porFornecedor, porProduto] = await Promise.all([
      comprasPorFornecedor(range, siteId),
      comprasPorProduto(range, siteId),
    ]);
    return { porFornecedor, porProduto };
  });

  const total = d.porFornecedor.reduce((s, f) => s + f.total, 0);
  const numNotas = d.porFornecedor.reduce((s, f) => s + f.numNotas, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total comprado" value={brl(total)} hint={periodo.label.toLowerCase()} goodWhen="down" destaque />
        <KpiCard label="Notas / entradas" value={String(numNotas)} />
        <KpiCard label="Fornecedores" value={String(d.porFornecedor.length)} />
      </div>

      <ChartCard title="Por fornecedor" subtitle="Quanto foi comprado de cada um">
        {d.porFornecedor.length === 0 ? <ChartEmpty /> : <BarList items={d.porFornecedor.slice(0, 10).map((f) => ({ label: f.supplierNome, value: f.total, sub: `${f.numNotas} nota(s)`, display: brl(f.total) }))} />}
      </ChartCard>

      <ChartCard title="Por produto" subtitle={`${d.porProduto.length} itens · custo unitário médio no período`}>
        {d.porProduto.length === 0 ? <ChartEmpty /> : <TabelaCompras linhas={d.porProduto} />}
      </ChartCard>
    </div>
  );
}
