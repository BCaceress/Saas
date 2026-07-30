"use server";

import { z } from "zod";
import { withTenant } from "@/lib/current-tenant";
import { guardAction } from "@/lib/guard";
import { getActiveSiteId } from "@/lib/sites";
import { fmtDataCompleta } from "@/lib/periodo";
import { completeJson, llmConfigured } from "@/lib/llm";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { codificarConsulta, consultaSchema, type Consulta } from "@/lib/analises/schema";
import { systemPromptConsulta } from "@/lib/analises/prompt";
import { ConsultaInvalidaError, executarConsulta } from "@/lib/analises/motor";
import { descreverConsulta } from "@/lib/analises/formato";
import type { ResultadoIA } from "./_schema";

/**
 * Relatório por linguagem natural. Fluxo seguro, em quatro passos:
 *  1. IA converte a pergunta → DSL de consulta (NUNCA SQL).
 *  2. Zod valida o DSL — nada fora do schema entra.
 *  3. O MOTOR executa via `db` (tenant injetado) e corta as métricas que a
 *     permissão não alcança. É o mesmo motor da tela de consulta, então a
 *     resposta do assistente abre lá para ajuste sem refazer nada.
 *  4. IA redige o insight SOBRE os números reais que voltaram.
 *
 * Tokens da LLM só no servidor. Erros voltam como `{ erro }` legível.
 */

const insightSchema = z.object({ insight: z.string() });

const SYSTEM_INSIGHT =
  'Você é analista de dados de um mercado. Escreva em português, 2-3 frases, um resumo com o insight principal dos dados fornecidos. Cite números reais dos dados. Não invente. Responda JSON: { "insight": "..." }.';

export async function perguntarIA(pergunta: string): Promise<ResultadoIA | { erro: string }> {
  const texto = (pergunta ?? "").trim();
  if (texto.length < 3) return { erro: "Escreva uma pergunta." };
  if (texto.length > 400) return { erro: "Pergunta muito longa. Seja mais direto." };
  if (!llmConfigured()) {
    return {
      erro: "IA não configurada neste ambiente. Defina a chave do provedor (ANTHROPIC_API_KEY ou GEMINI_API_KEY).",
    };
  }

  const ctx = await guardAction("relatorio.ver");

  // 1+2. IA → DSL → validação.
  let consulta: Consulta;
  try {
    const bruto = await completeJson<unknown>({ system: systemPromptConsulta(), user: texto });
    const parsed = consultaSchema.safeParse(bruto);
    if (!parsed.success) {
      return { erro: "Não consegui transformar isso num relatório. Tente reformular a pergunta." };
    }
    consulta = parsed.data;
  } catch {
    return { erro: "Falha ao interpretar a pergunta. Tente novamente." };
  }

  // 3. Motor, dentro do tenant.
  let resultado;
  try {
    resultado = await withTenant(ctx, async () =>
      executarConsulta({
        consulta,
        acessos: ctx.acessos,
        siteId: await getActiveSiteId(),
        policy: policyDoTenant(ctx.tenant),
      }),
    );
  } catch (e) {
    if (e instanceof ConsultaInvalidaError) return { erro: e.message };
    throw e;
  }

  // 4. IA lê os números que voltaram (amostra limitada p/ não estourar tokens).
  let insight: string;
  if (resultado.linhas.length === 0) {
    insight = "Nenhum dado encontrado para essa pergunta no período.";
  } else {
    try {
      const r = await completeJson<{ insight: string }>({
        system: SYSTEM_INSIGHT,
        user: `Pergunta do operador: "${texto}"\nDados (JSON):\n${JSON.stringify(resultado.brutas.slice(0, 40))}`,
      });
      insight = insightSchema.parse(r).insight;
    } catch {
      insight = "Dados carregados abaixo. (Não foi possível gerar o resumo automático.)";
    }
  }

  return {
    q: codificarConsulta(resultado.consulta),
    interpretacao: `${descreverConsulta(resultado)} · emitido ${fmtDataCompleta(new Date())}`,
    colunas: resultado.colunas,
    linhas: resultado.linhas,
    totalLinhas: resultado.totalGrupos,
    insight,
    metricasRemovidas: resultado.metricasRemovidas,
  };
}
