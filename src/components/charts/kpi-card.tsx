import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, Minus, ChevronRight, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { pct as fmtPct, type Variacao } from "@/lib/periodo";

type Tone = "brand" | "ok" | "info" | "danger";

const TONE_ICON: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand",
  ok: "bg-ok-soft text-ok",
  info: "bg-info-soft text-info",
  danger: "bg-danger-soft text-danger",
};

/** Miniatura na base do card — a forma segue o TIPO do dado, não o gosto (ver `chart`). */
export type KpiChart =
  /** Série contínua no tempo (dinheiro por dia): a leitura é a trajetória. */
  | { tipo: "area"; valores: number[] }
  /** Contagens discretas por dia: a leitura é comparar um dia com o outro. */
  | { tipo: "barras"; valores: number[] }
  /** Uma parte contra um total (não é série temporal): a leitura é "quanto do todo". */
  | { tipo: "medidor"; parte: number; total: number };

/**
 * KpiCard — o número que dói (PRD Fase 7 §10). Hierarquia: ícone da categoria,
 * valor grande, comparação de período com sinal+seta (não depende só de cor),
 * e uma miniatura ancorada na base do card.
 *
 * A miniatura NÃO é sempre a mesma forma: dinheiro no tempo vira área (mostra
 * trajetória), contagem por dia vira barras (compara dias), e proporção contra
 * um total vira medidor — desenhar proporção como série faria o operador ler
 * uma tendência que não existe naquele dado.
 *
 * Extensões do Centro de Operações Inteligente (opcionais, retrocompatíveis):
 * `chart`, `tooltip` (explica o indicador) e `iaHint` (leitura da IA, some por
 * padrão e aparece no hover — nunca ocupa espaço fixo).
 */
export function KpiCard({
  label,
  value,
  delta,
  hint,
  href,
  goodWhen = "up",
  destaque = false,
  icon: Icon,
  tone = "brand",
  chart,
  tooltip,
  iaHint,
}: {
  label: string;
  value: string;
  delta?: Variacao | null;
  hint?: string;
  href?: string;
  goodWhen?: "up" | "down";
  destaque?: boolean;
  /** Ícone da categoria (ex.: DollarSign p/ Receita), num tile colorido no topo do card. */
  icon?: LucideIcon;
  /** Cor do tile de ícone e da miniatura. */
  tone?: Tone;
  /** Miniatura da base — a forma vem do tipo do dado (ver KpiChart). */
  chart?: KpiChart;
  /** Explicação do indicador, mostrada em title nativo. */
  tooltip?: string;
  /**
   * Leitura da IA sobre este número — some, aparece só no hover/foco.
   * Aceita ReactNode para poder chegar por streaming (`<Suspense>`): o KPI
   * pinta na hora e a leitura entra depois, sem segurar o número na tela.
   * Quem passa nó é responsável por envolvê-lo em `<KpiIaHint>`.
   */
  iaHint?: ReactNode;
}) {
  const inner = (
    <div
      className={cn(
        "relative flex h-full flex-col gap-2 overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface p-4 transition-[transform,box-shadow,background-color,border-color] duration-200",
        href && "hover:border-brand/40 hover:bg-surface-2 hover:-translate-y-0.5 hover:shadow-(--shadow-1)",
        destaque && "border-brand/30 bg-brand-softer",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {Icon && (
            <span aria-hidden className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", TONE_ICON[tone])}>
              <Icon size={16} />
            </span>
          )}
          {/* O `title` fica no rótulo, não no card inteiro: no card, o tooltip
              nativo do browser subia por cima do popover do `iaHint` — dois
              balões disputando o mesmo hover. */}
          <span title={tooltip} className="text-xs font-medium uppercase tracking-wide text-muted">
            {label}
          </span>
        </div>
        {href && <ChevronRight size={15} className="text-faint transition-colors group-hover:text-brand" />}
      </div>
      {/* tabular-nums: sem largura fixa de dígito, o valor "dança" a cada
          refresh porque 1 e 8 têm larguras diferentes. */}
      <span
        className={cn(
          "font-display font-bold leading-none tracking-tight tabular-nums text-ink",
          destaque ? "text-[30px]" : "text-[25px]",
        )}
      >
        {value}
      </span>
      <div className="flex items-center gap-2">
        {delta && <DeltaBadge delta={delta} goodWhen={goodWhen} />}
        {hint && <span className="truncate text-xs text-faint">{hint}</span>}
      </div>

      {chart && <MiniChart chart={chart} tone={tone} label={label} />}

      {typeof iaHint === "string" ? <KpiIaHint>{iaHint}</KpiIaHint> : iaHint}
    </div>
  );

  // O `group` mora no elemento FOCÁVEL (o link), não no card: com ele no div
  // interno, `group-focus-visible` nunca dispararia — quem chega por teclado
  // foca o link, que é ancestral do div, e a leitura da IA ficaria só no mouse.
  return href ? (
    <Link
      href={href}
      className="group block h-full rounded-[var(--radius-lg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {inner}
    </Link>
  ) : (
    <div className="group h-full">{inner}</div>
  );
}

/**
 * Balão da leitura da IA, ancorado na base do card. Vive fora do KpiCard para
 * que um componente assíncrono possa devolvê-lo já pronto (ou devolver `null`
 * quando não há leitura) — assim o balão não existe vazio enquanto carrega.
 */
export function KpiIaHint({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 flex translate-y-1 items-start gap-1.5 rounded-lg border border-violet/25 bg-violet-soft px-2.5 py-2 text-xs text-violet opacity-0 shadow-(--shadow-2) transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
      <Sparkles size={13} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

const TONE_COR: Record<Tone, string> = {
  brand: "var(--color-brand)",
  ok: "var(--color-ok)",
  info: "var(--color-info)",
  danger: "var(--color-danger)",
};

/** Escolhe a forma da miniatura pelo tipo do dado. */
function MiniChart({ chart, tone, label }: { chart: KpiChart; tone: Tone; label: string }) {
  const cor = TONE_COR[tone];

  if (chart.tipo === "medidor") {
    const pct = chart.total > 0 ? Math.min(100, (chart.parte / chart.total) * 100) : 0;
    return (
      <div
        role="img"
        aria-label={`${label}: ${Math.round(pct)}% do total`}
        className="mt-auto h-2 w-full shrink-0 overflow-hidden rounded-full bg-line"
      >
        {/* Largura mínima visível: uma parte pequena mas real não pode sumir. */}
        <div className="h-full rounded-full" style={{ width: `${Math.max(pct, pct > 0 ? 3 : 0)}%`, background: cor }} />
      </div>
    );
  }

  if (chart.valores.length < 2) return null;

  if (chart.tipo === "barras") {
    const max = Math.max(...chart.valores, 1);
    return (
      // Barras em divs (não SVG esticado): rx e gap não distorcem, e o gap de
      // 2px separa as barras sem precisar de borda.
      <div role="img" aria-label={`${label}: variação por dia`} className="mt-auto flex h-6 w-full shrink-0 items-end gap-0.5">
        {chart.valores.map((v, i) => (
          <div
            key={i}
            className="min-h-0.5 flex-1 rounded-t-xs"
            style={{ height: `${(v / max) * 100}%`, background: cor }}
          />
        ))}
      </div>
    );
  }

  return <MiniArea valores={chart.valores} cor={cor} label={label} />;
}

/** Área + linha: trajetória de uma série contínua (uma única série, uma cor). */
function MiniArea({ valores, cor, label }: { valores: number[]; cor: string; label: string }) {
  const W = 100;
  const H = 26;
  const PAD = 2; // respiro pro traço não encostar nas bordas
  const max = Math.max(...valores);
  const min = Math.min(...valores);
  const span = max - min;

  const pontos = valores.map((v, i) => {
    const x = (i / (valores.length - 1)) * W;
    // Série constante: linha no meio da faixa. Normalizar por span=1 jogaria
    // tudo na base, e um valor estável leria como zero.
    const frac = span === 0 ? 0.5 : (v - min) / span;
    const y = H - PAD - frac * (H - PAD * 2);
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  const linha = `M${pontos.join(" L")}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="mt-auto h-6 w-full shrink-0"
      role="img"
      aria-label={`${label}: tendência do período`}
    >
      <path d={`${linha} L${W} ${H} L0 ${H} Z`} fill={cor} opacity={0.12} />
      {/* non-scaling-stroke: sem isso o preserveAspectRatio="none" esticaria a
          espessura do traço junto com o eixo X. */}
      <path d={linha} fill="none" stroke={cor} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function DeltaBadge({ delta, goodWhen }: { delta: Variacao; goodWhen: "up" | "down" }) {
  if (delta.dir === "flat" || delta.pct == null) {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-faint">
        <Minus size={13} /> {delta.pct == null ? "novo" : "estável"}
      </span>
    );
  }
  const bom = delta.dir === goodWhen;
  const Icon = delta.dir === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold",
        bom ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger",
      )}
    >
      <Icon size={13} />
      {fmtPct(Math.abs(delta.pct), 1)}
    </span>
  );
}
