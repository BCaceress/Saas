import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { ChartCard, ChartEmpty } from "@/components/charts/chart-card";
import { cn, brl } from "@/lib/utils";
import { pct as fmtPct } from "@/lib/periodo";
import type { CategoriaComparativo } from "./_data";

const AMOSTRA = 6;

/** Categorias — faturamento, margem, participação e tendência vs. período anterior. */
export function Categories({ categorias }: { categorias: CategoriaComparativo[] }) {
  const top = categorias.slice(0, AMOSTRA);

  return (
    <ChartCard title="Categorias" subtitle="Faturamento, lucro e participação no período">
      {top.length === 0 ? (
        <ChartEmpty />
      ) : (
        <ul className="flex flex-col gap-3.5">
          {top.map((c) => (
            <li key={c.categoria} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium text-ink">{c.categoria}</span>
                <span className="flex shrink-0 items-center gap-2 font-mono text-[13px] tabular-nums text-ink-2">
                  {brl(c.receita)}
                  {c.tendencia.dir !== "flat" && c.tendencia.pct != null && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-0.5 text-xs font-semibold",
                        c.tendencia.dir === "up" ? "text-ok" : "text-danger",
                      )}
                    >
                      {c.tendencia.dir === "up" ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                      {fmtPct(Math.abs(c.tendencia.pct), 0)}
                    </span>
                  )}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, Math.min(100, c.participacaoPct))}%` }} />
              </div>
              <p className="text-xs text-faint">
                {fmtPct(c.participacaoPct, 0)} do faturamento · margem {Math.round(c.margemPct)}%
              </p>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}
