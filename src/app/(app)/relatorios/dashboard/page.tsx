import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { resolvePeriodo, variacao, fmtData } from "@/lib/periodo";
import { brl } from "@/lib/utils";
import { KpiCard } from "@/components/charts/kpi-card";
import { ChartCard, ChartEmpty } from "@/components/charts/chart-card";
import { LineChart } from "@/components/charts/line-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { BarList } from "@/components/charts/bar-list";
import {
  resumoVendas,
  mixPagamento,
  ruptura,
  perdas,
  vendasPorDia,
  vendasPorCategoria,
  rankingProdutos,
  type Range,
} from "../_data";
import { PAYMENT_METHOD_LABELS } from "@/lib/presets";
import type { PaymentMethod } from "@/generated/prisma";
import Link from "next/link";

export default async function DashboardAnalisesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const ctx = await requireActiveTenant();
  const sp = await searchParams;
  const periodo = resolvePeriodo(sp);
  const range: Range = { inicio: periodo.inicio, fim: periodo.fim };
  const prevRange: Range = { inicio: periodo.prevInicio, fim: periodo.prevFim };
  const pdv = ctx.tenant.moduloPdv;

  const d = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const [resumo, resumoPrev, tendencia, categorias, ranking, mix, rupturaRows, perdaAtual] =
      await Promise.all([
        resumoVendas(range, siteId),
        resumoVendas(prevRange, siteId),
        vendasPorDia(range, siteId),
        vendasPorCategoria(range, siteId),
        rankingProdutos(range, siteId),
        pdv ? mixPagamento(range, siteId) : Promise.resolve([]),
        ruptura(siteId),
        perdas(range, siteId),
      ]);
    return { siteId, resumo, resumoPrev, tendencia, categorias, ranking, mix, rupturaRows, perdaAtual };
  });

  const { resumo, resumoPrev } = d;
  const semVendas = resumo.numVendas === 0;

  return (
    <div className="space-y-6">
      {/* Period context */}
      <p className="text-sm text-muted">
        Visão de <strong className="text-ink">{periodo.label.toLowerCase()}</strong> — comparado com período anterior.
      </p>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Faturamento"
          value={brl(resumo.faturamento)}
          delta={variacao(resumo.faturamento, resumoPrev.faturamento)}
          destaque
        />
        <KpiCard
          label="Margem bruta"
          value={brl(resumo.margemBruta)}
          delta={variacao(resumo.margemBruta, resumoPrev.margemBruta)}
          hint={`${Math.round(resumo.margemPct)}% da receita`}
        />
        <KpiCard
          label="Ticket médio"
          value={brl(resumo.ticket)}
          delta={variacao(resumo.ticket, resumoPrev.ticket)}
        />
        <KpiCard
          label="Vendas"
          value={String(resumo.numVendas)}
          delta={variacao(resumo.numVendas, resumoPrev.numVendas)}
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="CMV" value={brl(resumo.cmv)} hint="custo da mercadoria vendida" goodWhen="down" />
        <KpiCard
          label="Em ruptura"
          value={String(d.rupturaRows.length)}
          hint="produtos abaixo do mínimo"
          goodWhen="down"
        />
        <KpiCard
          label="Perdas"
          value={brl(d.perdaAtual.total)}
          hint={`${d.perdaAtual.itens.length} item(s)`}
          goodWhen="down"
        />
        <KpiCard label="Margem %" value={`${Math.round(resumo.margemPct)}%`} hint="sobre o faturamento" />
      </div>

      {/* Trend + Category */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Faturamento por dia"
          subtitle={periodo.label}
          className="lg:col-span-2"
          action={
            <Link href="/relatorios/vendas" className="text-xs font-medium text-brand hover:underline">
              Ver relatório →
            </Link>
          }
        >
          {semVendas ? (
            <ChartEmpty />
          ) : (
            <LineChart
              pontos={d.tendencia.map((p) => ({ data: fmtData(new Date(p.data)), valor: p.valor }))}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Por categoria"
          subtitle="Composição do faturamento"
          action={
            <Link href="/relatorios/vendas" className="text-xs font-medium text-brand hover:underline">
              Ver detalhes →
            </Link>
          }
        >
          {d.categorias.length === 0 ? (
            <ChartEmpty />
          ) : (
            <DonutChart
              fatias={d.categorias.slice(0, 6).map((c) => ({
                label: c.categoria,
                value: c.receita,
                display: brl(c.receita),
              }))}
            />
          )}
        </ChartCard>
      </div>

      {/* Top products + Payment mix / Ruptura */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Produtos que mais vendem"
          subtitle="Por faturamento no período"
          action={
            <Link href="/relatorios/vendas" className="text-xs font-medium text-brand hover:underline">
              Ver todos →
            </Link>
          }
        >
          {d.ranking.length === 0 ? (
            <ChartEmpty />
          ) : (
            <BarList
              items={d.ranking
                .slice(0, 6)
                .map((p) => ({ label: p.nome, value: p.receita, sub: p.sku, display: brl(p.receita) }))}
            />
          )}
        </ChartCard>

        {pdv && d.mix.length > 0 ? (
          <ChartCard
            title="Mix de pagamento"
            subtitle="Composição do recebido"
            action={
              <Link href="/relatorios/pagamentos" className="text-xs font-medium text-brand hover:underline">
                Ver relatório →
              </Link>
            }
          >
            <DonutChart
              fatias={d.mix.map((m) => ({
                label: PAYMENT_METHOD_LABELS[m.metodo as PaymentMethod] ?? m.metodo,
                value: m.valor,
                display: brl(m.valor),
              }))}
            />
          </ChartCard>
        ) : (
          <ChartCard
            title="Ruptura"
            subtitle="Produtos abaixo do mínimo"
            action={
              <Link href="/relatorios/estoque" className="text-xs font-medium text-brand hover:underline">
                Ver relatório →
              </Link>
            }
          >
            {d.rupturaRows.length === 0 ? (
              <ChartEmpty mensagem="Nenhum produto em ruptura." />
            ) : (
              <BarList
                tone="danger"
                items={d.rupturaRows.slice(0, 6).map((r) => ({
                  label: r.nome,
                  value: r.deficit,
                  sub: r.sku,
                  display: `falta ${r.deficit.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`,
                }))}
              />
            )}
          </ChartCard>
        )}
      </div>
    </div>
  );
}
