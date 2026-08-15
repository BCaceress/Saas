import Link from "next/link";
import { Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CONTROLE_LABELS, type EstoquePolicy } from "@/lib/estoque-estrategia";

/**
 * Qual régua a coluna de estoque está usando. A medida muda por empresa
 * (mínimo · mínimo+ideal · rotatividade) e sem isto ninguém sabe qual está
 * em uso — nem que dá para trocar.
 *
 * Dois formatos enquanto os dois lugares convivem:
 *  · "pill" — barra de filtros da lista (altura dos demais controles);
 *  · "chip" — cabeçalho da página, ao lado do seletor de loja.
 */
const ESTRATEGIA_CURTA: Record<EstoquePolicy["tipo"], string> = {
  MINIMO: "mínimo",
  MINIMO_IDEAL: "mín + ideal",
  ROTATIVIDADE: "rotatividade",
};

export function estrategiaTitle(policy: EstoquePolicy): string {
  const detalhe = policy.usaGiro
    ? `Cobertura desejada de ${policy.diasCobertura} dias, média dos últimos ${policy.periodoMediaDias} dias.`
    : policy.usaIdeal
      ? "Piso e nível ideal por produto."
      : "Piso por produto.";
  return `${CONTROLE_LABELS[policy.tipo].nome} — ${detalhe} Clique para alterar.`;
}

export function EstrategiaChip({
  policy,
  variant = "pill",
  className,
}: {
  policy: EstoquePolicy;
  variant?: "pill" | "chip";
  className?: string;
}) {
  return (
    <Link
      href="/configuracoes/estoque"
      title={estrategiaTitle(policy)}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface font-medium normal-case text-muted transition-colors hover:bg-surface-2 hover:text-ink",
        variant === "pill" ? "h-9 px-3 text-xs" : "px-3 py-2 text-sm",
        className,
      )}
    >
      <Settings2 size={14} className="shrink-0" />
      <span className="text-faint">Medindo por:</span>
      <span className="text-ink-2">{ESTRATEGIA_CURTA[policy.tipo]}</span>
    </Link>
  );
}
