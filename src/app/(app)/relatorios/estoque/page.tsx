import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { resolvePeriodo } from "@/lib/periodo";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { brl } from "@/lib/utils";
import { KpiCard } from "@/components/charts/kpi-card";
import { ChartCard, ChartEmpty } from "@/components/charts/chart-card";
import { BarList } from "@/components/charts/bar-list";
import { ruptura, valorEstoqueAtual, giroEstoque, posicaoEstoque, type Range } from "../_data";
import { TabelaEstoque } from "./tabela";
import { RelatorioShell } from "../_report-shell";

export default async function RelatorioEstoque({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const ctx = await requireActiveTenant();
  const periodo = resolvePeriodo(await searchParams);
  const range: Range = { inicio: periodo.inicio, fim: periodo.fim };

  const policy = policyDoTenant(ctx.tenant);
  const d = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const [rupturaRows, valor, giro, posicao] = await Promise.all([
      ruptura(siteId, policy),
      valorEstoqueAtual(siteId),
      giroEstoque(range, siteId),
      posicaoEstoque(siteId, policy),
    ]);
    return { rupturaRows, valor, giro, posicao };
  });

  return (
    <RelatorioShell titulo="Inventário" exportTipo="estoque">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Valor de estoque" value={brl(d.valor)} hint="a custo médio" destaque />
        <KpiCard
          label={policy.usaGiro ? "Sem estoque" : "Em ruptura"}
          value={String(d.rupturaRows.length)}
          hint={policy.usaGiro ? "saldo zerado" : "abaixo do mínimo"}
          goodWhen="down"
        />
        <KpiCard
          label="Giro"
          value={
            d.giro != null
              ? `${d.giro.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×`
              : "—"
          }
          hint={d.giro == null ? "sem histórico ainda" : periodo.label.toLowerCase()}
        />
        <KpiCard label="Itens em estoque" value={String(d.posicao.length)} />
      </div>

      <ChartCard
        title={policy.usaGiro ? "Sem estoque" : "Ruptura"}
        subtitle={
          policy.usaGiro
            ? "Produtos com saldo zerado — veja a sugestão por giro em Compras"
            : policy.usaIdeal
              ? "Produtos abaixo do mínimo, com déficit até o ideal"
              : "Produtos abaixo do mínimo, com déficit até o mínimo"
        }
      >
        {d.rupturaRows.length === 0 ? (
          <ChartEmpty mensagem={policy.usaGiro ? "Nenhum produto zerado." : "Nenhum produto em ruptura."} />
        ) : (
          <BarList
            tone="danger"
            items={d.rupturaRows.slice(0, 10).map((r) => ({
              label: r.nome,
              value: policy.usaGiro ? 1 : r.deficit,
              sub: `${r.siteNome} · ${r.sku}`,
              display: policy.usaGiro
                ? "zerado"
                : `falta ${r.deficit.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`,
            }))}
          />
        )}
      </ChartCard>

      <ChartCard title="Posição de estoque" subtitle={`${d.posicao.length} itens`}>
        {d.posicao.length === 0 ? (
          <ChartEmpty mensagem="Sem estoque registrado." />
        ) : (
          <TabelaEstoque linhas={d.posicao} />
        )}
      </ChartCard>
    </RelatorioShell>
  );
}
