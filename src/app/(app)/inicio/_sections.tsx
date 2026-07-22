import "server-only";
import { cache, Suspense, type ReactNode } from "react";
import Link from "next/link";
import { withTenant, type ActiveTenant } from "@/lib/current-tenant";
import { db } from "@/lib/prisma";
import { listSites } from "@/lib/sites";
import { brl } from "@/lib/utils";
import { BarList } from "@/components/charts/bar-list";
import { ChartCard } from "@/components/charts/chart-card";
import { KpiIaHint } from "@/components/charts/kpi-card";
import { SkChart, SkKpis, Sk } from "@/components/app/skeletons";
import { PAYMENT_METHOD_LABELS } from "@/lib/presets";
import type { PaymentMethod } from "@/generated/prisma";
import {
  resumoVendas,
  mixPagamento,
  ruptura,
  serieFinanceiraDiaria,
  vendasPorCategoria,
  type Range,
} from "../relatorios/_data";
import {
  pedidosEmAndamento,
  crescimentoProdutos,
  analiseReposicao,
  ritmoPedidos,
  totalItensEstoque,
  historicoDiario,
  feedbackInsights,
  produtosSemGiro,
  categoriasComparativo,
} from "./_data";
import { buildInsights, resumoAssistente, type Insight } from "./_insights";
import { AssistantPanel } from "./_assistant-panel";
import { KpiRow } from "./_kpi-row";
import { TrendChart } from "./_trend-chart";
import { PaymentMix } from "./_payment-mix";
import { InsightCards } from "./_insight-cards";
import { ProductCards, MarginProducts } from "./_product-cards";
import { DeadStock } from "./_dead-stock";
import { Categories } from "./_categories";
import type { WidgetId } from "./_widgets";

/**
 * Seções assíncronas do Centro de Operações.
 *
 * Antes a página inteira era um `Promise.all` de 19 leituras: nada aparecia até
 * a mais lenta terminar, e widgets ocultos pela personalização continuavam
 * pagando o custo da própria query. Aqui cada bloco é um componente assíncrono
 * dentro do seu `<Suspense>` — pinta quando ficar pronto, e widget não
 * renderizado simplesmente nunca dispara consulta.
 *
 * Duas regras para isso funcionar:
 *
 * 1. Todo carregador é memoizado com `cache()` e recebe o MESMO objeto `DashCtx`
 *    (montado uma vez na página). `cache` casa por identidade de argumento — é
 *    o que faz dois blocos pedirem "o resumo do período" e o banco ver uma
 *    consulta só.
 * 2. Toda seção reabre o contexto de tenant com `withTenant`. Ela roda fora da
 *    execução da página (o React chama depois, em streaming), e o
 *    AsyncLocalStorage não atravessa essa fronteira sozinho.
 */
export type DashCtx = {
  ctx: ActiveTenant;
  range: Range;
  prevRange: Range;
  siteId: string | null;
  periodoLabel: string;
  pdv: boolean;
  multiSite: boolean;
  paradoDias: number;
};

// ── Carregadores memoizados ─────────────────────────────────

const carregarResumo = cache((d: DashCtx) => resumoVendas(d.range, d.siteId));
const carregarResumoPrev = cache((d: DashCtx) => resumoVendas(d.prevRange, d.siteId));
const carregarSerie = cache((d: DashCtx) => serieFinanceiraDiaria(d.range, d.siteId));
const carregarRuptura = cache((d: DashCtx) => ruptura(d.siteId));
const carregarPedidos = cache((d: DashCtx) => pedidosEmAndamento(d.siteId));
const carregarCrescimento = cache((d: DashCtx) => crescimentoProdutos(d.range, d.prevRange, d.siteId));
const carregarReposicao = cache((d: DashCtx) => analiseReposicao(d.siteId));
const carregarRitmo = cache((d: DashCtx) => ritmoPedidos(d.range, d.prevRange, d.siteId));
const carregarTotalItens = cache((d: DashCtx) => totalItensEstoque(d.siteId));
const carregarHistorico = cache((d: DashCtx) => historicoDiario(d.prevRange, d.siteId));
const carregarSemGiro = cache((d: DashCtx) => produtosSemGiro(d.siteId, d.paradoDias));
const carregarCategoriasComp = cache((d: DashCtx) => categoriasComparativo(d.range, d.prevRange, d.siteId));
const carregarFeedback = cache((_d: DashCtx) => feedbackInsights());

// Sem PDV não há venda com forma de pagamento — devolver vazio evita a query.
const carregarMix = cache((d: DashCtx) => (d.pdv ? mixPagamento(d.range, d.siteId) : Promise.resolve([])));
const carregarMixPrev = cache((d: DashCtx) => (d.pdv ? mixPagamento(d.prevRange, d.siteId) : Promise.resolve([])));

const carregarCategorias = cache((d: DashCtx) => vendasPorCategoria(d.range, d.siteId));
const carregarCategoriasPrev = cache((d: DashCtx) => vendasPorCategoria(d.prevRange, d.siteId));

/** Rótulos legíveis (PIX, Dinheiro…) — o mix cru guarda o enum. */
const rotular = (mix: { metodo: string; valor: number; numVendas: number }[]) =>
  mix.map((m) => ({ ...m, metodo: PAYMENT_METHOD_LABELS[m.metodo as PaymentMethod] ?? m.metodo }));

/**
 * A análise completa — é o bloco caro da tela (junta 13 leituras). Fica atrás de
 * `cache` porque três consumidores a querem: o painel do assistente, o widget de
 * insights e as leituras de hover dos KPIs.
 */
const carregarInsights = cache(async (d: DashCtx): Promise<Insight[]> => {
  const [resumo, resumoPrev, rupturaRows, pedidos, crescimento, mix, mixPrev, serie, historico, categorias, categoriasPrev, reposicao, feedback] =
    await Promise.all([
      carregarResumo(d),
      carregarResumoPrev(d),
      carregarRuptura(d),
      carregarPedidos(d),
      carregarCrescimento(d),
      carregarMix(d),
      carregarMixPrev(d),
      carregarSerie(d),
      carregarHistorico(d),
      carregarCategorias(d),
      carregarCategoriasPrev(d),
      carregarReposicao(d),
      carregarFeedback(d),
    ]);

  return buildInsights({
    resumo,
    resumoPrev,
    rupturaRows,
    previsaoRuptura: reposicao.previsaoRuptura,
    pedidos,
    crescimento,
    mix: rotular(mix),
    mixPrev: rotular(mixPrev),
    serie,
    historico,
    categorias,
    categoriasPrev,
    oportunidades: reposicao.oportunidades,
    dismissedHoje: feedback.dismissedHoje,
    ignoreRatio: feedback.ignoreRatio,
  });
});

/** Atalho: toda seção roda dentro do contexto de tenant. */
const dentro = <T,>(d: DashCtx, fn: () => Promise<T>) => withTenant(d.ctx, fn);

// ── Assistente ──────────────────────────────────────────────

export async function AssistantSection({ d }: { d: DashCtx }) {
  const [insights, resumo] = await dentro(d, async () =>
    Promise.all([carregarInsights(d), carregarResumo(d)]),
  );

  // O humor sai do TOM dos insights, não da quantidade: quase sempre há algum
  // (inclusive de "sucesso"), e contar a lista deixaria o mascote em alerta
  // permanente.
  const humor = insights.some((i) => i.tom === "alerta")
    ? "alerta"
    : insights.some((i) => i.tom === "oportunidade")
      ? "atento"
      : "calmo";

  return (
    <AssistantPanel
      resumoInicial={resumoAssistente(insights)}
      topInsights={insights.slice(0, 3)}
      resumoNumeros={{ faturamento: resumo.faturamento, margemBruta: resumo.margemBruta }}
      insightsParaIA={insights.map((i) => ({ titulo: i.titulo, corpo: i.corpo, tom: i.tom }))}
      humor={humor}
    />
  );
}

export function AssistantFallback() {
  return (
    <div className="flex items-start gap-4 rounded-[var(--radius-lg)] border border-line bg-surface p-5">
      <Sk className="h-18 w-18 shrink-0 rounded-2xl" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
        <Sk className="h-3.5 w-44" />
        <Sk className="h-3.5 w-full max-w-md" />
        <Sk className="h-3.5 w-2/3 max-w-sm" />
      </div>
    </div>
  );
}

// ── KPIs ────────────────────────────────────────────────────

export async function KpiSection({ d }: { d: DashCtx }) {
  const [resumo, resumoPrev, serie, rupturaRows, totalItens, pedidos, ritmo] = await dentro(d, async () =>
    Promise.all([
      carregarResumo(d),
      carregarResumoPrev(d),
      carregarSerie(d),
      carregarRuptura(d),
      carregarTotalItens(d),
      carregarPedidos(d),
      carregarRitmo(d),
    ]),
  );

  return (
    <KpiRow
      resumo={resumo}
      resumoPrev={resumoPrev}
      serie={serie}
      rupturaCount={rupturaRows.length}
      totalItens={totalItens}
      pedidosAndamentoCount={pedidos.length}
      ritmo={ritmo}
      // As leituras da IA dependem da análise completa; entram depois, sozinhas,
      // sem segurar os números. Só aparecem no hover/foco de qualquer forma.
      hintFaturamento={<IaHintSlot d={d} id="faturamento" />}
      hintPedido={<IaHintSlot d={d} id="pedido-hoje" />}
    />
  );
}

export const KpiFallback = () => <SkKpis count={4} />;

function IaHintSlot({ d, id }: { d: DashCtx; id: string }) {
  return (
    <Suspense fallback={null}>
      <IaHint d={d} id={id} />
    </Suspense>
  );
}

async function IaHint({ d, id }: { d: DashCtx; id: string }) {
  const insights = await dentro(d, () => carregarInsights(d));
  const corpo = insights.find((i) => i.id === id)?.corpo;
  return corpo ? <KpiIaHint>{corpo}</KpiIaHint> : null;
}

// ── Widgets de análise ──────────────────────────────────────

async function Tendencia({ d }: { d: DashCtx }) {
  const [serie, resumo] = await dentro(d, async () => Promise.all([carregarSerie(d), carregarResumo(d)]));
  return <TrendChart serie={serie} periodoLabel={d.periodoLabel} semVendas={resumo.numVendas === 0} />;
}

/** Sem PDV não existe mix de pagamento — o espaço vira a lista de ruptura. */
async function MixOuRuptura({ d }: { d: DashCtx }) {
  if (!d.pdv) {
    const rupturaRows = await dentro(d, () => carregarRuptura(d));
    return (
      <ChartCard
        title="Ruptura"
        subtitle="Abaixo do mínimo, agora"
        action={
          <Link href="/estoque?filtro=baixoMinimo" className="text-xs font-medium text-brand hover:underline">
            Ver tudo
          </Link>
        }
      >
        {rupturaRows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">Nenhum produto em ruptura.</p>
        ) : (
          <BarList
            tone="danger"
            items={rupturaRows.slice(0, 6).map((r) => ({
              label: r.nome,
              value: r.deficit,
              sub: r.sku,
              display: `falta ${r.deficit.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`,
            }))}
          />
        )}
      </ChartCard>
    );
  }

  const mix = await dentro(d, () => carregarMix(d));
  return <PaymentMix mix={rotular(mix)} />;
}

async function Produtos({ d }: { d: DashCtx }) {
  const produtos = await dentro(d, () => carregarCrescimento(d));
  return <ProductCards produtos={produtos} />;
}

async function Margem({ d }: { d: DashCtx }) {
  const produtos = await dentro(d, () => carregarCrescimento(d));
  return <MarginProducts produtos={produtos} />;
}

async function Insights({ d }: { d: DashCtx }) {
  const insights = await dentro(d, () => carregarInsights(d));
  return <InsightCards insights={insights.filter((i) => i.escopo === "cards")} />;
}

async function SemGiro({ d }: { d: DashCtx }) {
  const produtos = await dentro(d, () => carregarSemGiro(d));
  return <DeadStock produtos={produtos} />;
}

async function CategoriasWidget({ d }: { d: DashCtx }) {
  const categorias = await dentro(d, () => carregarCategoriasComp(d));
  return <Categories categorias={categorias} />;
}

async function PorSite({ d }: { d: DashCtx }) {
  const linhas = await dentro(d, () => faturamentoPorSite(d.range));
  if (linhas.length === 0) return null;
  return (
    <ChartCard title="Faturamento por ponto" subtitle={d.periodoLabel}>
      <BarList tone="accent" items={linhas.map((s) => ({ label: s.nome, value: s.valor, display: brl(s.valor) }))} />
    </ChartCard>
  );
}

const WIDGETS: Record<WidgetId, (props: { d: DashCtx }) => ReactNode | Promise<ReactNode>> = {
  tendencia: Tendencia,
  mix: MixOuRuptura,
  produtos: Produtos,
  margem: Margem,
  insights: Insights,
  sem_giro: SemGiro,
  categorias: CategoriasWidget,
  por_site: PorSite,
};

/**
 * Um widget da grade, já embrulhado no próprio `<Suspense>`. Devolver `null`
 * aqui é o que impede a query: o componente nunca é chamado (é o caso de
 * "faturamento por ponto" em operação de ponto único).
 */
export function WidgetSlot({ id, d }: { id: WidgetId; d: DashCtx }) {
  if (id === "por_site" && !d.multiSite) return null;
  const Widget = WIDGETS[id];
  return (
    <Suspense fallback={<SkChart />}>
      <Widget d={d} />
    </Suspense>
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
