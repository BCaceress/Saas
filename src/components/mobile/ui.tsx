import Link from "next/link";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/**
 * Peças de forma da superfície `/m`.
 *
 * O app de mesa usa `<Card>` de `ui/misc` (canto 24px, sombra de painel
 * flutuante). No celular a régua é outra: canto de 20px (`--radius-m`), sombra
 * quase invisível (`--shadow-m`) e padding maior por dentro — o card precisa
 * descolar do canvas sem virar caixa empilhada.
 *
 * Tudo aqui é server component: são só forma e classe. Ritmo de espaço é
 * múltiplo de 8 (gap-2 = 8, gap-4 = 16, space-y-6 = 24) — o 4px sobra só para
 * detalhe dentro de um bloco.
 */

/* ── Cartão ───────────────────────────────────────────────────── */

export function MCard({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-m)] border border-line bg-surface shadow-[var(--shadow-m)]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Cartão que é um destino. Mesma forma do `MCard` mais o retorno de toque e o
 * anel de foco — todo alvo tocável da home passa por aqui, para que nenhum
 * fique com afundamento diferente do vizinho.
 */
export function MCardLink({
  href,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Link>) {
  return (
    <Link
      href={href}
      className={cn(
        "tap block rounded-[var(--radius-m)] border border-line bg-surface shadow-[var(--shadow-m)]",
        "hover:border-line-strong active:bg-surface-2",
        "focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
        className,
      )}
      {...props}
    >
      {children}
    </Link>
  );
}

/* ── Ícone em bolha ───────────────────────────────────────────── */

export type Tom =
  | "brand"
  | "accent"
  | "ok"
  | "warn"
  | "danger"
  | "info"
  | "violeta"
  | "neutro";

const TOM_BOLHA: Record<Tom, string> = {
  brand: "bg-brand-soft text-brand",
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  violeta: "bg-violet-soft text-violet",
  neutro: "bg-surface-2 text-ink-2",
};

/** Fundo tingido (cartão inteiro) — mesma paleta do `Tom`. */
export const TOM_FUNDO: Record<Tom, string> = {
  brand: "bg-brand-soft",
  accent: "bg-accent-soft",
  ok: "bg-ok-soft",
  warn: "bg-warn-soft",
  danger: "bg-danger-soft",
  info: "bg-info-soft",
  violeta: "bg-violet-soft",
  neutro: "bg-surface-2",
};

/** Só a tinta, sem fundo — usa em cima de superfície já tingida (cartão,
 * verniz claro), onde o par bg-tom/text-tom da `Bolha` sumiria por cima. */
export const TOM_TEXTO: Record<Tom, string> = {
  brand: "text-brand",
  accent: "text-accent",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  info: "text-info",
  violeta: "text-violet",
  neutro: "text-ink-2",
};

/** Preenchimento sólido no tom — só a barra de rodapé dos cards usa. */
const TOM_BARRA: Record<Tom, string> = {
  brand: "bg-brand",
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
  violeta: "bg-violet",
  neutro: "bg-ink-2",
};

const TAMANHO_BOLHA = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
} as const;

const TAMANHO_ICONE = { sm: 16, md: 20, lg: 24 } as const;

/**
 * Círculo suave atrás do ícone. Único jeito de um ícone aparecer nos cards da
 * `/m`: peso e tamanho iguais em toda a tela, cor só pelo tom semântico.
 */
export function Bolha({
  icone: Icone,
  tom = "neutro",
  tamanho = "md",
  forma = "circulo",
  claro = false,
  className,
}: {
  icone: LucideIcon;
  tom?: Tom;
  tamanho?: keyof typeof TAMANHO_BOLHA;
  /** Quadrada só nos atalhos: ali o ícone é botão de app, não marcador de
   * dado — a silhueta diferente separa "fazer" de "ler" sem mais uma cor. */
  forma?: "circulo" | "quadrada";
  /** Ícone sobre um cartão já tingido no mesmo tom: troca o par bg-tom/
   * text-tom por um verniz claro, senão o círculo some no próprio fundo. */
  claro?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center",
        forma === "quadrada" ? "rounded-[0.875rem]" : "rounded-full",
        TAMANHO_BOLHA[tamanho],
        claro ? cn("bg-surface/70", TOM_TEXTO[tom]) : TOM_BOLHA[tom],
        className,
      )}
      aria-hidden
    >
      <Icone size={TAMANHO_ICONE[tamanho]} strokeWidth={2} />
    </span>
  );
}

/* ── Barra de rodapé do card ──────────────────────────────────── */

/**
 * Fio de 4px no pé do cartão, no tom da linha. Não é medidor: é a cor do
 * estado repetida onde o polegar chega primeiro — cheia quando há algo a
 * fazer, apagada quando está zerado. Nenhum número é codificado nela.
 */
export function BarraTom({ tom, ativo }: { tom: Tom; ativo: boolean }) {
  return (
    <span
      className={cn(
        "block h-1 w-full rounded-full",
        ativo ? TOM_BARRA[tom] : cn(TOM_FUNDO[tom], "opacity-70"),
      )}
      aria-hidden
    />
  );
}

/* ── Avatar (inicial) ─────────────────────────────────────────── */

/** Círculo com a inicial do nome — mesma régua da `Bolha`, sem ícone. */
export function Avatar({
  nome,
  className,
}: {
  nome: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-soft font-display text-base font-semibold text-brand",
        className,
      )}
      aria-hidden
    >
      {nome.charAt(0).toUpperCase()}
    </span>
  );
}

/* ── Sparkline ────────────────────────────────────────────────── */

/**
 * Linha de tendência minimalista (SVG, sem eixos/labels): mostra a forma dos
 * últimos dias, não os números. Decorativa por natureza — é o card acima
 * dela que carrega o valor exato.
 */
export function Sparkline({
  valores,
  tom = "brand",
  altura = 28,
}: {
  valores: number[];
  tom?: Tom;
  altura?: number;
}) {
  if (valores.length < 2) return null;

  const max = Math.max(...valores);
  const min = Math.min(...valores);
  const amplitude = max - min || 1;
  const largura = 100;
  const passo = largura / (valores.length - 1);

  const pontos = valores
    .map((v, i) => `${(i * passo).toFixed(1)},${(altura - ((v - min) / amplitude) * altura).toFixed(1)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${largura} ${altura}`}
      preserveAspectRatio="none"
      className={cn("block h-full w-full", TOM_TEXTO[tom])}
      aria-hidden
    >
      <polygon points={`0,${altura} ${pontos} ${largura},${altura}`} className="fill-current opacity-15" />
      <polyline
        points={pontos}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className="fill-none stroke-current"
      />
    </svg>
  );
}

/* ── Cabeçalho de seção ───────────────────────────────────────── */

/**
 * Título de seção da home. 18px, sempre com a mesma distância do bloco que
 * vem embaixo — é o que separa "Operação" de "Ações rápidas" sem precisar de
 * mais uma borda na tela.
 */
export function SecaoTitulo({
  children,
  acao,
  className,
}: {
  children: React.ReactNode;
  /** Conteúdo alinhado à direita (contador, link "ver tudo"). */
  acao?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 px-1", className)}>
      <h2 className="font-display text-lg leading-tight font-semibold text-ink">{children}</h2>
      {acao}
    </div>
  );
}
