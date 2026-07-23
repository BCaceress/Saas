import { Suspense } from "react";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { resolvePeriodo } from "@/lib/periodo";
import { featureAtiva } from "@/lib/planos";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";
import { ReportFilters } from "@/components/app/report-filters";
import { saudacao } from "./_insights";
import { RefreshButton } from "./_refresh-button";
import { DashboardSettings } from "./_dashboard-settings";
import { getDashboardWidgetPref } from "./actions";
import { resolveOrder, type WidgetId } from "./_widgets";
import {
  AssistantSection,
  AssistantFallback,
  KpiSection,
  KpiFallback,
  WidgetSlot,
  type DashCtx,
} from "./_sections";
import type { Range } from "../relatorios/_data";

/**
 * Centro de Operações. A página é só a casca: resolve período, site e
 * preferências (leituras baratas) e entrega cada bloco pesado a um `<Suspense>`
 * próprio — cabeçalho e filtros aparecem de imediato, o resto entra em
 * streaming conforme fica pronto. As leituras vivem em `_sections.tsx`.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; de?: string; ate?: string }>;
}) {
  const ctx = await requireActiveTenant();
  const sp = await searchParams;
  const periodo = resolvePeriodo(sp);
  const agora = new Date();

  const [{ sites, siteId }, widgetPref] = await Promise.all([
    withTenant(ctx, async () => {
      const [sites, siteId] = await Promise.all([listSites(), getActiveSiteId()]);
      return { sites, siteId };
    }),
    getDashboardWidgetPref(),
  ]);

  const multiSite = (ctx.tenant.numPontos ?? 1) > 1 || sites.length > 1;

  // Os objetos Range nascem AQUI e são drilados por referência: os carregadores
  // de `_sections.tsx` são memoizados com `cache()`, que casa por identidade de
  // argumento — recriar o Range em cada seção refaria toda consulta.
  const range: Range = { inicio: periodo.inicio, fim: periodo.fim };
  const prevRange: Range = { inicio: periodo.prevInicio, fim: periodo.prevFim };

  const dash: DashCtx = {
    ctx,
    range,
    prevRange,
    siteId,
    periodoLabel: periodo.label,
    pdv: featureAtiva(ctx.tenant, "pdv"),
    multiSite,
    paradoDias: ctx.tenant.produtoParadoDias || 45,
  };

  const resolvedOrder = resolveOrder(widgetPref.ordem);
  const visibleWidgets = resolvedOrder.filter((id) => !widgetPref.hidden.includes(id));

  return (
    <div className="space-y-4 pb-6">
      {/* Letterhead — só aparece no PDF (window.print); sidebar/navbar/ações já somem via print:hidden. */}
      <div className="hidden print:block">
        <p className="font-display text-lg font-semibold">{ctx.tenant.nome}</p>
        <p className="text-sm text-muted">
          Centro de Operações · {periodo.label} · emitido {agora.toLocaleDateString("pt-BR")} às{" "}
          {agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>

      <PageHeader
        title={`${saudacao(agora)}!`}
        icon={navIcon("/inicio")}
        description={`Resumo da operação de ${periodo.label.toLowerCase()}.`}
        innerClassName="max-w-none"
        actions={
          <>
            <RefreshButton atualizadoEm={agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} />
            <DashboardSettings order={resolvedOrder} hidden={widgetPref.hidden} />
            <ReportFilters sites={sites} activeSiteId={siteId} multiSite={multiSite} />
          </>
        }
      />

      <Suspense fallback={<AssistantFallback />}>
        <AssistantSection d={dash} />
      </Suspense>

      <div className="fade-up" style={{ animationDelay: "40ms" }}>
        <Suspense fallback={<KpiFallback />}>
          <KpiSection d={dash} />
        </Suspense>
      </div>

      {/* `empty:hidden`: um widget que resolve para nada (ponto único, período
          sem dado) não pode deixar um buraco do tamanho de um card na grade. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:grid-flow-dense">
        {visibleWidgets.map((id, i) => (
          <div key={id} className={cn("fade-up empty:hidden", WIDGET_SPAN[id])} style={{ animationDelay: `${80 + i * 40}ms` }}>
            <WidgetSlot id={id} d={dash} />
          </div>
        ))}
      </div>
    </div>
  );
}

const WIDGET_SPAN: Record<WidgetId, string> = {
  // Meia largura: a tendência abre a grade logo abaixo dos KPIs e divide a
  // linha com o widget seguinte, em vez de ocupar a faixa inteira.
  tendencia: "lg:col-span-1",
  mix: "lg:col-span-1",
  produtos: "lg:col-span-1",
  margem: "lg:col-span-1",
  insights: "lg:col-span-1",
  sem_giro: "lg:col-span-1",
  categorias: "lg:col-span-1",
  por_site: "lg:col-span-2",
  fiscal: "lg:col-span-1",
};
