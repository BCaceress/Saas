/**
 * Dia civil da loja — sem banco, importável de RSC, action e client.
 *
 * Por que existe: "hoje" e "ontem" são perguntas de CALENDÁRIO, não de horas
 * decorridas. Dividir a diferença em milissegundos por 86.400.000 diz "hoje"
 * para uma venda das 20h de ontem consultada às 10h de hoje — que foi o defeito
 * que estas funções corrigem.
 *
 * O fuso é fixo no do Brasil de propósito: o servidor da Vercel roda em UTC e o
 * navegador roda no fuso do aparelho. Sem fixar, a MESMA venda cai em dias
 * diferentes conforme quem formata — e as 21h de qualquer dia já viram o dia
 * seguinte em UTC.
 */

export const FUSO_LOJA = "America/Sao_Paulo";

const PARTES = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO_LOJA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Dia civil da loja no formato `YYYY-MM-DD` — chave de agrupamento por dia. */
export function diaDaLoja(valor: Date | string | number): string {
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return "";
  const p = PARTES.formatToParts(d);
  const parte = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${parte("year")}-${parte("month")}-${parte("day")}`;
}

/** `YYYY-MM-DD` → instante de meia-noite (UTC) só para subtrair dias inteiros. */
function meioDiaCivil(chave: string): number {
  const [a, m, d] = chave.split("-").map(Number);
  return Date.UTC(a, (m ?? 1) - 1, d ?? 1);
}

/**
 * Dias de calendário entre a data e hoje, no fuso da loja. 0 = hoje, 1 = ontem.
 * `null` quando a data não existe ou é inválida.
 */
export function diasDeCalendario(
  valor: Date | string | number | null | undefined,
  agora: Date = new Date(),
): number | null {
  if (valor == null) return null;
  const dia = diaDaLoja(valor);
  if (!dia) return null;
  const diff = (meioDiaCivil(diaDaLoja(agora)) - meioDiaCivil(dia)) / 86_400_000;
  return Math.round(diff);
}
