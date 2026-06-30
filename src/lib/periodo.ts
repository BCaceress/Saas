/**
 * Período de relatório (PRD Fase 7 §6) — presets + intervalo + período anterior
 * para a comparação. Funções puras, sem DB. Datas em horário local do servidor;
 * intervalos são [inicio, fim) (fim exclusivo → meia-noite do dia seguinte).
 */

export type PeriodPreset = "hoje" | "7d" | "30d" | "mes" | "custom";

export type Periodo = {
  preset: PeriodPreset;
  inicio: Date;
  fim: Date; // exclusivo
  label: string;
  /** Período imediatamente anterior, de mesma duração — base da comparação. */
  prevInicio: Date;
  prevFim: Date;
};

const DIA = 24 * 60 * 60 * 1000;

function meiaNoite(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const PRESET_LABEL: Record<Exclude<PeriodPreset, "custom">, string> = {
  hoje: "Hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  mes: "Este mês",
};

/** Resolve o período a partir dos searchParams (?periodo=&de=&ate=). */
export function resolvePeriodo(params: {
  periodo?: string;
  de?: string;
  ate?: string;
}): Periodo {
  const hojeZero = meiaNoite(new Date());
  const amanha = new Date(hojeZero.getTime() + DIA);
  const preset = (params.periodo ?? "7d") as PeriodPreset;

  let inicio: Date;
  let fim = amanha;
  let label: string;

  if (preset === "custom" && params.de) {
    inicio = meiaNoite(new Date(params.de));
    fim = params.ate ? new Date(meiaNoite(new Date(params.ate)).getTime() + DIA) : amanha;
    label = `${fmtData(inicio)} – ${fmtData(new Date(fim.getTime() - DIA))}`;
  } else if (preset === "hoje") {
    inicio = hojeZero;
    label = PRESET_LABEL.hoje;
  } else if (preset === "30d") {
    inicio = new Date(hojeZero.getTime() - 29 * DIA);
    label = PRESET_LABEL["30d"];
  } else if (preset === "mes") {
    inicio = new Date(hojeZero.getFullYear(), hojeZero.getMonth(), 1);
    label = PRESET_LABEL.mes;
  } else {
    inicio = new Date(hojeZero.getTime() - 6 * DIA);
    label = PRESET_LABEL["7d"];
  }

  const duracao = fim.getTime() - inicio.getTime();
  const prevFim = inicio;
  const prevInicio = new Date(inicio.getTime() - duracao);

  return { preset: preset === "custom" && !params.de ? "7d" : preset, inicio, fim, label, prevInicio, prevFim };
}

// ── Formatação (pt-BR) ──────────────────────────────────────

export function fmtData(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function fmtDataCompleta(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Número grande compacto: 1234 → "1,2 mil", 1_200_000 → "1,2 mi". */
export function compacto(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${(v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

export function pct(v: number, casas = 0): string {
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

export type Variacao = {
  /** Variação percentual vs. período anterior. null quando base é zero. */
  pct: number | null;
  /** "up" | "down" | "flat" — só a direção, sem juízo de bom/ruim. */
  dir: "up" | "down" | "flat";
};

/** Variação de `atual` sobre `anterior`. */
export function variacao(atual: number, anterior: number): Variacao {
  if (anterior === 0) {
    if (atual === 0) return { pct: null, dir: "flat" };
    return { pct: null, dir: "up" };
  }
  const p = ((atual - anterior) / Math.abs(anterior)) * 100;
  const dir = Math.abs(p) < 0.05 ? "flat" : p > 0 ? "up" : "down";
  return { pct: Math.round(p * 10) / 10, dir };
}
