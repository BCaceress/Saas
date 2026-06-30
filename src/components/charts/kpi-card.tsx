import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, Minus, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { pct as fmtPct, type Variacao } from "@/lib/periodo";

/**
 * KpiCard — o número que dói (PRD Fase 7 §10). Hierarquia: valor grande, rótulo
 * discreto, comparação de período ao lado com sinal+seta (não depende só de cor).
 * `goodWhen` define a cor semântica: subir é bom por padrão; em perda/quebra,
 * subir é ruim.
 */
export function KpiCard({
  label,
  value,
  delta,
  hint,
  href,
  goodWhen = "up",
  destaque = false,
}: {
  label: string;
  value: string;
  delta?: Variacao | null;
  hint?: string;
  href?: string;
  goodWhen?: "up" | "down";
  destaque?: boolean;
}) {
  const inner = (
    <div
      className={cn(
        "group flex h-full flex-col gap-2 rounded-[var(--radius-lg)] border border-line bg-surface p-5 transition-colors",
        href && "hover:border-brand/40 hover:bg-surface-2",
        destaque && "border-brand/30 bg-brand-softer",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
        {href && <ChevronRight size={15} className="text-faint transition-colors group-hover:text-brand" />}
      </div>
      <span
        className={cn(
          "font-display font-bold leading-none tracking-tight text-ink",
          destaque ? "text-[34px]" : "text-[28px]",
        )}
      >
        {value}
      </span>
      <div className="mt-auto flex items-center gap-2 pt-1">
        {delta && <DeltaBadge delta={delta} goodWhen={goodWhen} />}
        {hint && <span className="text-xs text-faint">{hint}</span>}
      </div>
    </div>
  );

  return href ? <Link href={href}>{inner}</Link> : inner;
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
