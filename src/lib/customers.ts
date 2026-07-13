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

/** Limites (R$) dos níveis acima do base — ajustáveis em Configurações → Fidelização. */
export type TierThresholds = {
  bronze: number;
  prata: number;
  ouro: number;
  diamante: number;
};

/** Valores de fábrica — usados até o operador ajustar (Tenant.tier*Min). */
export const DEFAULT_TIER_THRESHOLDS: TierThresholds = {
  bronze: 200,
  prata: 500,
  ouro: 2000,
  diamante: 5000,
};

const TIER_META: Record<TierKey, Omit<Tier, "minGasto">> = {
  diamante: { key: "diamante", label: "Cliente Diamante", estrelas: 5, text: "text-tier-diamond", soft: "bg-tier-diamond-soft" },
  ouro: { key: "ouro", label: "Cliente Ouro", estrelas: 4, text: "text-tier-gold", soft: "bg-tier-gold-soft" },
  prata: { key: "prata", label: "Cliente Prata", estrelas: 3, text: "text-tier-silver", soft: "bg-tier-silver-soft" },
  bronze: { key: "bronze", label: "Cliente Bronze", estrelas: 2, text: "text-warn", soft: "bg-warn-soft" },
  cobre: { key: "cobre", label: "Cliente Cobre", estrelas: 1, text: "text-faint", soft: "bg-surface-2" },
};

/** Escada de fidelidade — do maior para o menor (avaliada em ordem). Cobre é sempre R$ 0. */
export function tiersFromThresholds(t: TierThresholds = DEFAULT_TIER_THRESHOLDS): Tier[] {
  return [
    { ...TIER_META.diamante, minGasto: t.diamante },
    { ...TIER_META.ouro, minGasto: t.ouro },
    { ...TIER_META.prata, minGasto: t.prata },
    { ...TIER_META.bronze, minGasto: t.bronze },
    { ...TIER_META.cobre, minGasto: 0 },
  ];
}

/** Escada com os limites padrão de fábrica — usar quando o tenant ainda não foi carregado. */
export const TIERS: Tier[] = tiersFromThresholds();

export function tierFromGasto(totalGasto: number, thresholds?: TierThresholds): Tier {
  const escada = thresholds ? tiersFromThresholds(thresholds) : TIERS;
  return escada.find((t) => totalGasto >= t.minGasto) ?? escada[escada.length - 1];
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

export type StatusTone = "ok" | "warn" | "muted" | "faint";

/** Status comportamental do cliente, derivado do histórico de compras. */
export function statusCliente(
  insights: { diasSemComprar: number | null; visitasMes: number },
  diasRisco: number,
): { label: string; tone: StatusTone } {
  if (insights.diasSemComprar == null) return { label: "Sem compras ainda", tone: "faint" };
  if (insights.diasSemComprar >= diasRisco)
    return { label: `Não compra há ${insights.diasSemComprar} dias`, tone: "warn" };
  if (insights.visitasMes >= 3) return { label: "Cliente frequente", tone: "ok" };
  return { label: "Ativo", tone: "muted" };
}
