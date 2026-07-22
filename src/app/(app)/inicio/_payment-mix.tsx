import { ChartCard, ChartEmpty } from "@/components/charts/chart-card";
import { BarList } from "@/components/charts/bar-list";
import { brl } from "@/lib/utils";
import { pct } from "@/lib/periodo";
import type { MixPagamento } from "../relatorios/_data";

/** Mix de pagamento em barras horizontais (não pizza) — valor, % e nº de vendas por método. */
export function PaymentMix({ mix }: { mix: MixPagamento[] }) {
  const total = mix.reduce((s, m) => s + m.valor, 0);
  const totalVendas = mix.reduce((s, m) => s + m.numVendas, 0);

  return (
    <ChartCard title="Mix de pagamento" subtitle="Recebido no período">
      {mix.length === 0 ? (
        <ChartEmpty />
      ) : (
        <>
          <BarList
            items={mix.map((m) => ({
              label: m.metodo,
              value: m.valor,
              sub: `${m.numVendas} venda${m.numVendas === 1 ? "" : "s"}`,
              display: `${brl(m.valor)} · ${total > 0 ? pct(Math.round((m.valor / total) * 100)) : "—"}`,
            }))}
          />
          <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3 text-sm">
            <span className="font-semibold text-ink">Total</span>
            <span className="font-mono text-[13px] tabular-nums text-ink-2">
              {brl(total)} · 100% · {totalVendas.toLocaleString("pt-BR")} venda{totalVendas === 1 ? "" : "s"}
            </span>
          </div>
        </>
      )}
    </ChartCard>
  );
}
