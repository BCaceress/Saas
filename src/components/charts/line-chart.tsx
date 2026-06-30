import { brl } from "@/lib/utils";

export type SeriePonto = { data: string; valor: number };

/**
 * Linha de tendência (PRD §10: tendência → linha). SVG responsivo, sem deps.
 * Tooltip via <title> nativo nos pontos. Área suave sob a linha com o brand.
 */
export function LineChart({
  pontos,
  formato = brl,
  altura = 180,
}: {
  pontos: SeriePonto[];
  formato?: (v: number) => string;
  altura?: number;
}) {
  const W = 600;
  const H = altura;
  const pad = { top: 12, right: 8, bottom: 22, left: 8 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const max = Math.max(1, ...pontos.map((p) => p.valor));
  const n = pontos.length;
  const x = (i: number) => pad.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;

  const linha = pontos.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.valor).toFixed(1)}`).join(" ");
  const area = `${linha} L ${x(n - 1).toFixed(1)} ${(pad.top + innerH).toFixed(1)} L ${x(0).toFixed(1)} ${(pad.top + innerH).toFixed(1)} Z`;

  // rótulos esparsos no eixo X (primeiro, meio, último)
  const idxs = n <= 1 ? [0] : [...new Set([0, Math.floor((n - 1) / 2), n - 1])];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Gráfico de tendência" preserveAspectRatio="none">
      <path d={area} fill="var(--brand)" opacity={0.08} />
      <path d={linha} fill="none" stroke="var(--brand)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {pontos.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.valor)} r={2.5} fill="var(--brand)">
          <title>{`${p.data}: ${formato(p.valor)}`}</title>
        </circle>
      ))}
      {idxs.map((i) => (
        <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="fill-faint" fontSize={11}>
          {pontos[i]?.data}
        </text>
      ))}
    </svg>
  );
}
