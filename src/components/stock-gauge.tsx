import { cn } from "@/lib/utils";
import type { BaseUnit } from "@/generated/prisma";

/**
 * Assinatura visual: medidor de saldo dois-saldos (PRD §8.8).
 * Mostra fechadas (un) + a aberta (% da unidade em uso). Cor pelo nível
 * vs. estoque mínimo/ideal. Ex.: "4 fechadas + 1 aberta · 20%".
 */
export function StockGauge({
  fechado,
  aberto = 0,
  conteudoPorUnidade,
  minimo = 0,
  ideal = 0,
  unidade = "UN",
  fracionavel = false,
  className,
}: {
  fechado: number;
  aberto?: number;
  conteudoPorUnidade?: number | null;
  minimo?: number;
  ideal?: number;
  unidade?: BaseUnit;
  fracionavel?: boolean;
  className?: string;
}) {
  const pctAberta =
    fracionavel && conteudoPorUnidade && conteudoPorUnidade > 0
      ? Math.min(100, Math.round((aberto / conteudoPorUnidade) * 100))
      : 0;

  const level: "danger" | "warn" | "ok" =
    fechado <= minimo ? "danger" : ideal > 0 && fechado < ideal ? "warn" : "ok";

  const barColor =
    level === "danger"
      ? "bg-danger"
      : level === "warn"
        ? "bg-warn"
        : "bg-brand";

  // Preenchimento da barra: progresso rumo ao ideal (ou só "tem estoque").
  const fillPct =
    ideal > 0
      ? Math.min(100, Math.round((fechado / ideal) * 100))
      : fechado > 0
        ? 100
        : 0;

  const aberturaLabel = fracionavel
    ? aberto > 0
      ? `1 aberta · ${pctAberta}%`
      : "nenhuma aberta"
    : null;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-sm font-semibold text-ink tnum">
          {fechado}
        </span>
        <span className="text-[11px] text-muted">
          {fechado === 1 ? "fechada" : "fechadas"}
        </span>
        {aberturaLabel && aberto > 0 && (
          <span className="text-[11px] text-accent">+ {aberturaLabel}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <div
          className="relative h-1.5 w-20 overflow-hidden rounded-full bg-line"
          role="meter"
          aria-valuenow={fechado}
          aria-valuemin={0}
          aria-valuemax={ideal || undefined}
          aria-label={`Estoque: ${fechado} ${unidade}`}
        >
          <div
            className={cn("h-full rounded-full transition-all", barColor)}
            style={{ width: `${fillPct}%` }}
          />
          {/* marca do estoque mínimo */}
          {ideal > 0 && minimo > 0 && (
            <span
              aria-hidden
              className="absolute top-0 h-full w-px bg-ink/40"
              style={{ left: `${Math.min(100, (minimo / ideal) * 100)}%` }}
            />
          )}
        </div>
        {level === "danger" && (
          <span className="text-[10px] font-medium text-danger">repor</span>
        )}
      </div>
    </div>
  );
}
