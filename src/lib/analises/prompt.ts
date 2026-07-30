import { CATALOGO } from "./catalogo";
import { GRANULARIDADES, OPERADORES, PRESETS } from "./schema";

/**
 * Instrução da IA — GERADA a partir do catálogo, nunca escrita à mão.
 *
 * É o que mantém a promessa da arquitetura: dimensão ou métrica nova entra no
 * vocabulário do assistente no mesmo commit em que entra no motor. Prompt
 * escrito à mão envelhece em silêncio — a IA continua oferecendo o mundo antigo
 * e o operador nunca descobre o que passou a existir.
 */
export function systemPromptConsulta(): string {
  const fatos = CATALOGO.map((f) => {
    const dims = f.dimensoes.map((d) => `    - ${d.id}: ${d.descricao}`).join("\n");
    const mets = f.metricas.map((m) => `    - ${m.id}: ${m.descricao}`).join("\n");
    return [
      `- ${f.id} — ${f.descricao}${f.usaPeriodo ? "" : " (ignora o período: é o saldo de agora)"}`,
      `  dimensões:`,
      dims,
      `  métricas:`,
      mets,
    ].join("\n");
  }).join("\n");

  return `Você traduz perguntas de um operador de mercado (em português) sobre os dados dele em um objeto JSON de consulta. NUNCA escreva SQL. Responda SOMENTE com o JSON, sem texto ao redor e sem cercas de código.

Formato:
{
  "fato": um dos fatos abaixo,
  "dimensoes": lista de até 3 dimensões daquele fato (vazia = total, sem quebra),
  "metricas": lista de 1 a 6 métricas daquele fato,
  "filtros": [{ "campo": dimensão ou métrica, "op": ${OPERADORES.map((o) => `"${o}"`).join("|")}, "valor": texto ou número }],
  "periodo": { "preset": ${PRESETS.map((p) => `"${p}"`).join("|")}, "de"?: "AAAA-MM-DD", "ate"?: "AAAA-MM-DD" },
  "granularidade": ${GRANULARIDADES.map((g) => `"${g}"`).join("|")} (só com a dimensão de tempo),
  "comparar": true para confrontar com o período anterior,
  "ordenar": { "por": métrica ou dimensão, "ordem": "asc"|"desc" },
  "limite": número de 1 a 500
}

Fatos disponíveis:
${fatos}

Como interpretar:
- "mais vendidos" → ordenar por quantidade, desc. "que mais faturaram" → por receita, desc.
- "pior margem" / "menos rentável" → ordenar por margemPct, asc. "melhor margem" → desc.
- "margem abaixo de X%" → filtro { campo: "margemPct", op: "<=", valor: X }.
- "por dia", "ao longo do mês", "evolução" → dimensão "tempo" com a granularidade que couber.
- "comparado com o mês passado", "cresceu?" → comparar: true.
- "top N" → limite: N. Sem número citado, use 20.
- Nome de produto, categoria ou fornecedor citado na pergunta → filtro com op "contem".
- Período não citado → "30d". "hoje" → "hoje". "este mês" → "mes". "semana" → "7d".
- Use SEMPRE os identificadores exatos listados acima. Não invente dimensão nem métrica.`;
}
