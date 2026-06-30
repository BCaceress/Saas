import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { resolvePeriodo } from "@/lib/periodo";
import { brl } from "@/lib/utils";
import { KpiCard } from "@/components/charts/kpi-card";
import { ChartCard, ChartEmpty } from "@/components/charts/chart-card";
import { DonutChart } from "@/components/charts/donut-chart";
import { mixPagamento, fechamentosCaixa, type Range } from "../_data";
import { TabelaPagamentos } from "./tabela";
import { PAYMENT_METHOD_LABELS } from "@/lib/presets";
import type { PaymentMethod } from "@/generated/prisma";

export default async function RelatorioPagamentos({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireActiveTenant();
  const periodo = resolvePeriodo(await searchParams);
  const range: Range = { inicio: periodo.inicio, fim: periodo.fim };

  const d = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const [mix, fechamentos] = await Promise.all([mixPagamento(range, siteId), fechamentosCaixa(range, siteId)]);
    return { mix, fechamentos };
  });

  const totalRecebido = d.mix.reduce((s, m) => s + m.valor, 0);
  const quebraTotal = d.fechamentos.reduce((s, f) => s + (f.quebra ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total recebido" value={brl(totalRecebido)} hint={periodo.label.toLowerCase()} destaque />
        <KpiCard label="Fechamentos" value={String(d.fechamentos.length)} hint="caixas fechados" />
        <KpiCard label="Quebra de caixa" value={brl(quebraTotal)} hint="contado − esperado" goodWhen="up" />
      </div>

      <ChartCard title="Mix de pagamento" subtitle="Composição do recebido">
        {d.mix.length === 0 ? (
          <ChartEmpty />
        ) : (
          <DonutChart fatias={d.mix.map((m) => ({ label: PAYMENT_METHOD_LABELS[m.metodo as PaymentMethod] ?? m.metodo, value: m.valor, display: brl(m.valor) }))} />
        )}
      </ChartCard>

      <ChartCard title="Fechamentos de caixa" subtitle="X/Z e quebra por sessão">
        {d.fechamentos.length === 0 ? (
          <ChartEmpty mensagem="Nenhum caixa fechado no período." />
        ) : (
          <TabelaPagamentos linhas={d.fechamentos} />
        )}
      </ChartCard>
    </div>
  );
}
