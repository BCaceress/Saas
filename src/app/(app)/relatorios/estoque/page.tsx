import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { resolvePeriodo } from "@/lib/periodo";
import { brl } from "@/lib/utils";
import { KpiCard } from "@/components/charts/kpi-card";
import { ChartCard, ChartEmpty } from "@/components/charts/chart-card";
import { BarList } from "@/components/charts/bar-list";
import { ruptura, valorEstoqueAtual, giroEstoque, posicaoEstoque, type Range } from "../_data";
import { TabelaEstoque } from "./tabela";

export default async function RelatorioEstoque({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireActiveTenant();
  const periodo = resolvePeriodo(await searchParams);
  const range: Range = { inicio: periodo.inicio, fim: periodo.fim };

  const d = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const [rupturaRows, valor, giro, posicao] = await Promise.all([
      ruptura(siteId),
      valorEstoqueAtual(siteId),
      giroEstoque(range, siteId),
      posicaoEstoque(siteId),
    ]);
    return { rupturaRows, valor, giro, posicao };
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Valor de estoque" value={brl(d.valor)} hint="a custo médio" destaque />
        <KpiCard label="Em ruptura" value={String(d.rupturaRows.length)} hint="abaixo do mínimo" goodWhen="down" />
        <KpiCard label="Giro" value={d.giro != null ? `${d.giro.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : "—"} hint={d.giro == null ? "sem histórico ainda" : periodo.label.toLowerCase()} />
        <KpiCard label="Itens em estoque" value={String(d.posicao.length)} />
      </div>

      <ChartCard title="Ruptura" subtitle="Produtos abaixo do mínimo, com déficit até o ideal">
        {d.rupturaRows.length === 0 ? (
          <ChartEmpty mensagem="Nenhum produto em ruptura. 👍" />
        ) : (
          <BarList tone="danger" items={d.rupturaRows.slice(0, 10).map((r) => ({ label: r.nome, value: r.deficit, sub: `${r.siteNome} · ${r.sku}`, display: `falta ${r.deficit.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}` }))} />
        )}
      </ChartCard>

      <ChartCard title="Posição de estoque" subtitle={`${d.posicao.length} itens`}>
        {d.posicao.length === 0 ? <ChartEmpty mensagem="Sem estoque registrado." /> : <TabelaEstoque linhas={d.posicao} />}
      </ChartCard>
    </div>
  );
}
