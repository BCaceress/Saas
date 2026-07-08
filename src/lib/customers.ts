/**
 * Fidelização — regras de apresentação client-safe (sem banco).
 * Tier do cliente derivado do total gasto; formatação de datas pt-BR.
 */

export type TierKey = "cobre" | "bronze" | "prata" | "ouro" | "diamante";

export type Tier = {
  key: TierKey;
  label: string;
  estrelas: number; // preenchidas (de 5)
  /** Limite inferior de total gasto (R$). */
  minGasto: number;
  /** Classes de cor (texto + fundo suave). */
  text: string;
  soft: string;
};

/** Escada de fidelidade — do maior para o menor (avaliada em ordem). */
export const TIERS: Tier[] = [
  { key: "diamante", label: "Cliente Diamante", estrelas: 5, minGasto: 5000, text: "text-brand", soft: "bg-brand-soft" },
  { key: "ouro", label: "Cliente Ouro", estrelas: 4, minGasto: 2000, text: "text-accent", soft: "bg-accent-soft" },
  { key: "prata", label: "Cliente Prata", estrelas: 3, minGasto: 500, text: "text-muted", soft: "bg-surface-2" },
  { key: "bronze", label: "Cliente Bronze", estrelas: 2, minGasto: 200, text: "text-warn", soft: "bg-warn-soft" },
  { key: "cobre", label: "Cliente Cobre", estrelas: 1, minGasto: 0, text: "text-faint", soft: "bg-surface-2" },
];

export function tierFromGasto(totalGasto: number): Tier {
  return TIERS.find((t) => totalGasto >= t.minGasto) ?? TIERS[TIERS.length - 1];
}

/** dd/mm/aaaa a partir de ISO (fuso local) — para timestamps. "—" se nulo. */
export function fmtData(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * dd/mm/aaaa para datas puras (`@db.Date`, gravadas à meia-noite UTC). Formata
 * em UTC para não deslocar o dia no fuso do navegador (BR = UTC-3). "—" se nulo.
 */
export function fmtDataUTC(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

/** "hoje", "ontem", "há 3 dias", "há 2 meses". "—" se nulo. */
export function fmtDiasAtras(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const dias = Math.floor((Date.now() - then) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.round(dias / 30);
  return meses === 1 ? "há 1 mês" : `há ${meses} meses`;
}

export const SEXO_LABEL: Record<string, string> = {
  MASCULINO: "Masculino",
  FEMININO: "Feminino",
  OUTRO: "Outro",
};
