export type ParetoItem = { label: string; value: number; acumuladoPct: number; classe: "A" | "B" | "C" };

const COR_CLASSE: Record<"A" | "B" | "C", string> = {
  A: "var(--brand)",
  B: "var(--accent)",
  C: "var(--faint)",
};

/**
 * Pareto / curva ABC (PRD §10: concentração → pareto). Barras de faturamento
 * coloridas por classe + linha de % acumulado. SVG, sem deps.
 */
export function ParetoChart({ itens, altura = 220 }: { itens: ParetoItem[]; altura?: number }) {
  const dados = itens.slice(0, 20);
  const W = 640;
  const H = altura;
  const pad = { top: 14, right: 8, bottom: 28, left: 8 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const max = Math.max(1, ...dados.map((d) => d.value));
  const n = dados.length;
  const gap = 4;
  const bw = n > 0 ? innerW / n - gap : 0;

  const cx = (i: number) => pad.left + i * (innerW / n) + (innerW / n) / 2;
  const cy = (p: number) => pad.top + innerH - (p / 100) * innerH;
  const linha = dados.map((d, i) => `${i === 0 ? "M" : "L"} ${cx(i).toFixed(1)} ${cy(d.acumuladoPct).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Curva ABC">
      {/* linhas-guia 80% / 95% */}
      {[80, 95].map((g) => (
        <g key={g}>
          <line x1={pad.left} x2={W - pad.right} y1={cy(g)} y2={cy(g)} stroke="var(--line)" strokeDasharray="3 3" />
          <text x={W - pad.right} y={cy(g) - 3} textAnchor="end" fontSize={10} className="fill-faint">{g}%</text>
        </g>
      ))}
      {/* barras */}
      {dados.map((d, i) => {
        const h = (d.value / max) * innerH;
        return (
          <rect
            key={i}
            x={pad.left + i * (innerW / n) + gap / 2}
            y={pad.top + innerH - h}
            width={Math.max(2, bw)}
            height={h}
            rx={2}
            fill={COR_CLASSE[d.classe]}
          >
            <title>{`${d.label} — ${d.classe} (${Math.round(d.acumuladoPct)}% acum.)`}</title>
          </rect>
        );
      })}
      {/* linha acumulada */}
      <path d={linha} fill="none" stroke="var(--ink-2)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {dados.map((d, i) => (
        <circle key={i} cx={cx(i)} cy={cy(d.acumuladoPct)} r={2} fill="var(--ink-2)" />
      ))}
    </svg>
  );
}
