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

// ============================================================
// Fronteira do dia da loja.
//
// `diaDaLoja` responde "que dia é esse instante"; o que falta é o contrário —
// "que instante começa esse dia" —, que é o que um filtro `gte`/`lt` de banco
// precisa. Fazer isso com `new Date(ano, mês, dia)` usa o fuso do PROCESSO: na
// Vercel (UTC) a meia-noite calculada é 21h do dia anterior no Brasil, e das
// 21h à meia-noite o "hoje" da tela vira o dia seguinte — as vendas do dia
// inteiro passam a só aparecer em "Ontem".
// ============================================================

const RELOGIO = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO_LOJA,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Deslocamento do fuso da loja (ms) no instante dado. Negativo no Brasil. */
function deslocamento(instante: Date): number {
  const p = RELOGIO.formatToParts(instante);
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  const comoSeFosseUTC = Date.UTC(
    n("year"),
    n("month") - 1,
    n("day"),
    n("hour"),
    n("minute"),
    n("second"),
  );
  return comoSeFosseUTC - Math.floor(instante.getTime() / 1000) * 1000;
}

/**
 * `YYYY-MM-DD` → o instante em que esse dia COMEÇA na loja.
 *
 * Duas passadas: o deslocamento é medido no palpite e conferido no resultado.
 * O Brasil não usa horário de verão desde 2019, mas um dia de virada de fuso
 * deslocaria a meia-noite em uma hora, e a segunda passada absorve isso.
 */
export function inicioDoDiaLojaEm(chave: string): Date {
  const [a, m, d] = chave.split("-").map(Number);
  const palpite = Date.UTC(a, (m ?? 1) - 1, d ?? 1);
  const primeiro = palpite - deslocamento(new Date(palpite));
  return new Date(palpite - deslocamento(new Date(primeiro)));
}

/** Meia-noite da loja do dia que contém `valor` (padrão: agora). */
export function inicioDoDiaLoja(valor: Date = new Date()): Date {
  return inicioDoDiaLojaEm(diaDaLoja(valor));
}

/** Ano/mês/dia civis da loja — para aritmética de calendário (mês, ano). */
export function partesDoDiaLoja(valor: Date = new Date()): {
  ano: number;
  mes: number;
  dia: number;
} {
  const [ano, mes, dia] = diaDaLoja(valor).split("-").map(Number);
  return { ano: ano ?? 1970, mes: mes ?? 1, dia: dia ?? 1 };
}

/** Hora cheia (0–23) do instante, no fuso da loja — eixo do gráfico por hora. */
export function horaDaLoja(valor: Date): number {
  const p = RELOGIO.formatToParts(valor);
  return Number(p.find((x) => x.type === "hour")?.value ?? 0);
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
