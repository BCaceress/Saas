import type { Granularidade } from "../schema";

/**
 * Buckets de tempo. A chave é sempre ORDENÁVEL como texto (`2026-07` < `2026-08`)
 * — é o que permite ordenar a série cronologicamente sem carregar Date por toda
 * a agregação. O rótulo em pt-BR é montado só na formatação final.
 */

const p2 = (n: number) => String(n).padStart(2, "0");

export function chaveTempo(d: Date, granularidade: Granularidade): string {
  switch (granularidade) {
    case "hora":
      // Padrão de horário do dia: todas as terças às 14h caem no mesmo balde.
      return p2(d.getHours());
    case "mes":
      return `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
    case "semana": {
      const { ano, semana } = semanaISO(d);
      return `${ano}-W${p2(semana)}`;
    }
    default:
      return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  }
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function rotuloTempo(chave: string, granularidade: Granularidade): string {
  switch (granularidade) {
    case "hora":
      return `${chave}h`;
    case "mes": {
      const [ano, mes] = chave.split("-");
      return `${MESES[Number(mes) - 1] ?? mes}/${ano.slice(2)}`;
    }
    case "semana": {
      const [ano, sem] = chave.split("-W");
      return `sem. ${Number(sem)}/${ano.slice(2)}`;
    }
    default: {
      const [ano, mes, dia] = chave.split("-");
      return `${dia}/${mes}/${ano.slice(2)}`;
    }
  }
}

/** Semana ISO-8601: começa na segunda, a semana 1 é a que contém a 1ª quinta. */
function semanaISO(d: Date): { ano: number; semana: number } {
  const alvo = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // Quinta-feira da mesma semana define o ano ISO.
  alvo.setDate(alvo.getDate() + 3 - ((alvo.getDay() + 6) % 7));
  const primeiraQuinta = new Date(alvo.getFullYear(), 0, 4);
  primeiraQuinta.setDate(primeiraQuinta.getDate() + 3 - ((primeiraQuinta.getDay() + 6) % 7));
  const dias = Math.round((alvo.getTime() - primeiraQuinta.getTime()) / 86_400_000);
  return { ano: alvo.getFullYear(), semana: 1 + Math.floor(dias / 7) };
}

// ── Dia da semana ───────────────────────────────────────────

const DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

/** Chave ordenável 1-7 (segunda a domingo), para a semana não começar no domingo. */
export function chaveDiaSemana(d: Date): string {
  return String(((d.getDay() + 6) % 7) + 1);
}

export function rotuloDiaSemana(chave: string): string {
  return DIAS[Number(chave) - 1] ?? chave;
}
