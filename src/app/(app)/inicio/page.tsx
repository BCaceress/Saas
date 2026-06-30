import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { db } from "@/lib/prisma";
import { resolvePeriodo, variacao, fmtData } from "@/lib/periodo";
import { brl } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { ReportFilters } from "@/components/app/report-filters";
import { KpiCard } from "@/components/charts/kpi-card";
import { ChartCard, ChartEmpty } from "@/components/charts/chart-card";
import { LineChart } from "@/components/charts/line-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { BarList } from "@/components/charts/bar-list";
import {
  resumoVendas,
  mixPagamento,
  ruptura,
  valorEstoqueAtual,
  giroEstoque,
  perdas,
  vendasPorDia,
  rankingProdutos,
  type Range,
} from "../relatorios/_data";
import { PAYMENT_METHOD_LABELS } from "@/lib/presets";
import type { PaymentMethod, TipoOperacao } from "@/generated/prisma";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; de?: string; ate?: string }>;
}) {
  const ctx = await requireActiveTenant();
  const sp = await searchParams;
  const periodo = resolvePeriodo(sp);
  const range: Range = { inicio: periodo.inicio, fim: periodo.fim };
  const prevRange: Range = { inicio: periodo.prevInicio, fim: periodo.prevFim };
  const tipo = (ctx.tenant.tipoOperacao ?? "MERCADINHO") as TipoOperacao;
  const pdv = ctx.tenant.moduloPdv;

  const data = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const [
      sites,
      resumo,
      resumoPrev,
      mix,
      rupturaRows,
      valorEstoque,
      giro,
      perdaAtual,
      perdaPrev,
      tendencia,
      ranking,
      porSite,
    ] = await Promise.all([
      listSites(),
      resumoVendas(range, siteId),
      resumoVendas(prevRange, siteId),
      pdv ? mixPagamento(range, siteId) : Promise.resolve([]),
      ruptura(siteId),
      valorEstoqueAtual(siteId),
      giroEstoque(range, siteId),
      perdas(range, siteId),
      perdas(prevRange, siteId),
      vendasPorDia(range, siteId),
      rankingProdutos(range, siteId),
      faturamentoPorSite(range),
    ]);
    return {
      siteId,
      sites,
      resumo,
      resumoPrev,
      mix,
      rupturaRows,
      valorEstoque,
      giro,
      perdaAtual,
      perdaPrev,
      tendencia,
      ranking,
      porSite,
    };
  });

  const multiSite = (ctx.tenant.numPontos ?? 1) > 1 || data.sites.length > 1;
  const { resumo, resumoPrev } = data;

  // KPIs por preset (PRD §3) — só o que dói no modelo de operação.
  const cards = montarCards(tipo, {
    resumo,
    resumoPrev,
    ruptura: data.rupturaRows.length,
    valorEstoque: data.valorEstoque,
    giro: data.giro,
    perdaAtual: data.perdaAtual.total,
    perdaPrev: data.perdaPrev.total,
  });

  const semVendas = resumo.numVendas === 0;

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="Início"
        description={`Visão de ${periodo.label.toLowerCase()} — o que precisa de atenção primeiro.`}
        eyebrow="Painel"
        innerClassName="max-w-none"
        actions={<ReportFilters sites={data.sites} activeSiteId={data.siteId} multiSite={multiSite} />}
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c, i) => (
          <KpiCard key={c.label} {...c} destaque={i === 0} />
        ))}
      </div>

      {/* Tendência + composição/atenção */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Faturamento por dia" subtitle={periodo.label} className="lg:col-span-2">
          {semVendas ? (
            <ChartEmpty />
          ) : (
            <LineChart pontos={data.tendencia.map((p) => ({ data: fmtData(new Date(p.data)), valor: p.valor }))} />
          )}
        </ChartCard>

        {pdv ? (
          <ChartCard title="Mix de pagamento" subtitle="Recebido no período">
            {data.mix.length === 0 ? (
              <ChartEmpty />
            ) : (
              <DonutChart
                fatias={data.mix.map((m) => ({
                  label: PAYMENT_METHOD_LABELS[m.metodo as PaymentMethod] ?? m.metodo,
                  value: m.valor,
                  display: brl(m.valor),
                }))}
              />
            )}
          </ChartCard>
        ) : (
          <ChartCard
            title="Ruptura"
            subtitle="Abaixo do mínimo, agora"
            action={<a href="/relatorios/estoque" className="text-xs font-medium text-brand hover:underline">Ver tudo</a>}
          >
            {data.rupturaRows.length === 0 ? (
              <ChartEmpty mensagem="Nenhum produto em ruptura." />
            ) : (
              <BarList
                tone="danger"
                items={data.rupturaRows.slice(0, 6).map((r) => ({
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

      {/* Top produtos + (multi-site) por ponto */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Produtos que mais vendem"
          subtitle="Por faturamento"
          action={<a href="/relatorios/vendas" className="text-xs font-medium text-brand hover:underline">Ver relatório</a>}
        >
          {data.ranking.length === 0 ? (
            <ChartEmpty />
          ) : (
            <BarList items={data.ranking.slice(0, 6).map((p) => ({ label: p.nome, value: p.receita, sub: p.sku, display: brl(p.receita) }))} />
          )}
        </ChartCard>

        {multiSite && data.porSite.length > 0 ? (
          <ChartCard title="Faturamento por ponto" subtitle={periodo.label}>
            <BarList tone="accent" items={data.porSite.map((s) => ({ label: s.nome, value: s.valor, display: brl(s.valor) }))} />
          </ChartCard>
        ) : (
          <ChartCard
            title="Maior margem"
            subtitle="Receita − custo, por produto"
            action={<a href="/relatorios/margem" className="text-xs font-medium text-brand hover:underline">Ver relatório</a>}
          >
            {data.ranking.filter((p) => p.custo > 0).length === 0 ? (
              <ChartEmpty mensagem="Sem custo cadastrado para calcular margem." />
            ) : (
              <BarList
                tone="accent"
                items={[...data.ranking]
                  .filter((p) => p.custo > 0)
                  .sort((a, b) => b.margem - a.margem)
                  .slice(0, 6)
                  .map((p) => ({ label: p.nome, value: p.margem, sub: `${Math.round(p.margemPct)}%`, display: brl(p.margem) }))}
              />
            )}
          </ChartCard>
        )}
      </div>
    </div>
  );
}

/** Faturamento agregado por site (para multi-ponto). */
async function faturamentoPorSite(range: Range) {
  const [grupos, sites] = await Promise.all([
    db.sale.groupBy({
      by: ["siteId"],
      where: { status: "PAGA", paidAt: { gte: range.inicio, lt: range.fim } },
      _sum: { total: true },
    }),
    listSites(),
  ]);
  const nomeMap = new Map(sites.map((s) => [s.id, s.nome]));
  return grupos
    .map((g) => ({ nome: nomeMap.get(g.siteId) ?? g.siteId, valor: Number(g._sum.total ?? 0) }))
    .filter((g) => g.valor > 0)
    .sort((a, b) => b.valor - a.valor);
}

// ── Montagem de KPIs por preset ─────────────────────────────

type CardProps = {
  label: string;
  value: string;
  delta?: ReturnType<typeof variacao> | null;
  hint?: string;
  href?: string;
  goodWhen?: "up" | "down";
};

function montarCards(
  tipo: TipoOperacao,
  d: {
    resumo: { faturamento: number; ticket: number; margemBruta: number; margemPct: number };
    resumoPrev: { faturamento: number; ticket: number; margemBruta: number };
    ruptura: number;
    valorEstoque: number;
    giro: number | null;
    perdaAtual: number;
    perdaPrev: number;
  },
): CardProps[] {
  const faturamento: CardProps = {
    label: "Faturamento",
    value: brl(d.resumo.faturamento),
    delta: variacao(d.resumo.faturamento, d.resumoPrev.faturamento),
    href: "/relatorios/vendas",
  };
  const margem: CardProps = {
    label: "Margem bruta",
    value: brl(d.resumo.margemBruta),
    delta: variacao(d.resumo.margemBruta, d.resumoPrev.margemBruta),
    hint: `${Math.round(d.resumo.margemPct)}% da receita`,
    href: "/relatorios/margem",
  };
  const ticket: CardProps = {
    label: "Ticket médio",
    value: brl(d.resumo.ticket),
    delta: variacao(d.resumo.ticket, d.resumoPrev.ticket),
    href: "/relatorios/vendas",
  };
  const rupturaCard: CardProps = {
    label: "Em ruptura",
    value: String(d.ruptura),
    hint: "abaixo do mínimo",
    goodWhen: "down",
    href: "/relatorios/estoque",
  };
  const perdaCard: CardProps = {
    label: "Perdas",
    value: brl(d.perdaAtual),
    delta: variacao(d.perdaAtual, d.perdaPrev),
    goodWhen: "down",
    href: "/relatorios/perdas",
  };
  const estoque: CardProps = {
    label: "Valor de estoque",
    value: brl(d.valorEstoque),
    hint: "a custo médio",
    href: "/relatorios/estoque",
  };
  const giro: CardProps = {
    label: "Giro de estoque",
    value: d.giro != null ? `${d.giro.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : "—",
    hint: d.giro == null ? "sem histórico ainda" : "no período",
    href: "/relatorios/estoque",
  };

  if (tipo === "AUTONOMO") return [faturamento, rupturaCard, perdaCard, estoque];
  if (tipo === "CONVENIENCIA_BEBIDAS") return [faturamento, margem, giro, rupturaCard];
  return [faturamento, margem, ticket, estoque]; // MERCADINHO
}
