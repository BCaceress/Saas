import { cn } from "@/lib/utils";

export type BarItem = {
  label: string;
  value: number;
  /** Texto formatado à direita (ex.: "R$ 1.234"). Default: value local. */
  display?: string;
  sub?: string; // segunda linha discreta sob o label
};

/**
 * Ranking em barras horizontais (PRD §10: posição → barra). Largura proporcional
 * ao maior valor. CSS puro — sem dependência de gráfico.
 */
export function BarList({
  items,
  tone = "brand",
}: {
  items: BarItem[];
  tone?: "brand" | "accent" | "danger";
}) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  const barColor =
    tone === "accent" ? "bg-accent" : tone === "danger" ? "bg-danger" : "bg-brand";

  return (
    <ul className="flex flex-col gap-3">
      {items.map((it, i) => (
        <li key={`${it.label}-${i}`} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium text-ink">
              {it.label}
              {it.sub && <span className="ml-2 font-mono text-xs text-faint">{it.sub}</span>}
            </span>
            <span className="shrink-0 font-mono text-[13px] tabular-nums text-ink-2">
              {it.display ?? it.value.toLocaleString("pt-BR")}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn("h-full rounded-full", barColor)}
              style={{ width: `${Math.max(2, (Math.abs(it.value) / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
