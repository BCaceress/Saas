import { cn } from "@/lib/utils";

export type FatiaDonut = { label: string; value: number; display?: string };

// Paleta fria→quente da "vitrine refrigerada" (cyan → âmbar). Poucas fatias.
const PALETA = ["var(--brand)", "var(--accent)", "var(--brand-strong)", "var(--ok)", "var(--muted)", "var(--faint)"];

/**
 * Rosca de composição (PRD §10: composição → rosca com poucas fatias). SVG via
 * stroke-dasharray. Legenda ao lado com valor formatado.
 */
export function DonutChart({ fatias }: { fatias: FatiaDonut[] }) {
  const total = fatias.reduce((s, f) => s + f.value, 0);
  const R = 60;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 160 160" className="h-40 w-40 shrink-0 -rotate-90">
        <circle cx={80} cy={80} r={R} fill="none" stroke="var(--surface-2)" strokeWidth={20} />
        {total > 0 &&
          fatias.map((f, i) => {
            const frac = f.value / total;
            const dash = frac * C;
            const el = (
              <circle
                key={i}
                cx={80}
                cy={80}
                r={R}
                fill="none"
                stroke={PALETA[i % PALETA.length]}
                strokeWidth={20}
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-offset}
              >
                <title>{`${f.label}: ${f.display ?? f.value}`}</title>
              </circle>
            );
            offset += dash;
            return el;
          })}
      </svg>

      <ul className="flex min-w-0 flex-col gap-2">
        {fatias.map((f, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <span
              className={cn("h-2.5 w-2.5 shrink-0 rounded-full")}
              style={{ background: PALETA[i % PALETA.length] }}
            />
            <span className="min-w-0 truncate text-ink">{f.label}</span>
            <span className="ml-auto font-mono text-[13px] tabular-nums text-ink-2">
              {f.display ?? f.value.toLocaleString("pt-BR")}
            </span>
            <span className="w-12 text-right font-mono text-xs text-faint">
              {total > 0 ? `${Math.round((f.value / total) * 100)}%` : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
