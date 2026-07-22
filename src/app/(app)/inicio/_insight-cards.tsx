import { ChartCard, ChartEmpty } from "@/components/charts/chart-card";
import { InsightCardItem } from "./_insight-card-item";
import type { Insight } from "./_insights";

/** Seção "Insights inteligentes" — cards com ícone, leitura e ação rápida, não listas cruas. */
export function InsightCards({ insights }: { insights: Insight[] }) {
  return (
    <ChartCard title="Insights inteligentes" subtitle="Leituras automáticas sobre o período">
      {insights.length === 0 ? (
        <ChartEmpty mensagem="Sem leituras adicionais para este período." />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {insights.map((insight) => (
            <InsightCardItem key={insight.id} insight={insight} />
          ))}
        </ul>
      )}
    </ChartCard>
  );
}
