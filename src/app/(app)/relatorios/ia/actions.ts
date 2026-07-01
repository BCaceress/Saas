"use server";

import { z } from "zod";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { resolvePeriodo, fmtDataCompleta } from "@/lib/periodo";
import { completeJson, llmConfigured } from "@/lib/llm";
import type { Range } from "../_data";
import { consultaSchema, FONTES, type Consulta, type ResultadoIA } from "./_schema";
import { resolverConsulta } from "./_resolver";

/**
 * Relatório por linguagem natural (Fase 7 §12). Fluxo seguro:
 *  1. IA converte a pergunta → DSL de consulta (NUNCA SQL).
 *  2. Zod valida o DSL — rejeita qualquer coisa fora do schema.
 *  3. Resolver executa via `db` (tenant injetado) — isolamento garantido.
 *  4. IA redige o insight SOBRE os números reais (não inventa dados).
 * Tokens da LLM só no servidor. Erros voltam como `{ erro }` legível.
 */

const PRESET_LABEL: Record<string, string> = { hoje: "hoje", "7d": "últimos 7 dias", "30d": "últimos 30 dias", mes: "este mês", custom: "período personalizado" };
const FONTE_LABEL: Record<string, string> = {
  produtos: "produtos vendidos",
  categorias: "vendas por categoria",
  pagamentos: "mix de pagamento",
  perdas: "perdas",
  compras: "compras",
  estoque: "posição de estoque",
  caixa: "fechamentos de caixa",
  abc: "curva ABC",
};

function interpretar(c: Consulta): string {
  const partes: string[] = [FONTE_LABEL[c.fonte] ?? c.fonte];
  partes.push(`no período de ${PRESET_LABEL[c.periodo.preset] ?? c.periodo.preset}`);
  if (c.filtros?.categoria) partes.push(`categoria "${c.filtros.categoria}"`);
  if (c.filtros?.margemPctMax != null) partes.push(`margem ≤ ${c.filtros.margemPctMax}%`);
  if (c.filtros?.margemPctMin != null) partes.push(`margem ≥ ${c.filtros.margemPctMin}%`);
  if (c.filtros?.receitaMin != null) partes.push(`receita ≥ R$ ${c.filtros.receitaMin}`);
  if (c.ordenarPor) partes.push(`ordenado por ${c.ordenarPor} (${c.ordem})`);
  partes.push(`top ${c.limite}`);
  return partes.join(" · ");
}

const SYSTEM_DSL = `Você traduz perguntas de um operador de mercado (em português) sobre os dados dele em um objeto JSON de consulta. NUNCA escreva SQL. Responda SOMENTE com o JSON, sem texto extra.

Schema:
{
  "fonte": ${FONTES.map((f) => `"${f}"`).join(" | ")},
  "periodo": { "preset": "hoje"|"7d"|"30d"|"mes"|"custom", "de"?: "YYYY-MM-DD", "ate"?: "YYYY-MM-DD" },
  "ordenarPor"?: "receita"|"margem"|"margemPct"|"quantidade"|"custo"|"valor",
  "ordem"?: "asc"|"desc",
  "limite"?: número (1-100),
  "filtros"?: { "categoria"?: string, "margemPctMin"?: número, "margemPctMax"?: número, "receitaMin"?: número, "quantidadeMin"?: número }
}

Significado das fontes:
- produtos: ranking de produtos vendidos (receita, cmv, margem, quantidade).
- categorias: vendas somadas por categoria.
- pagamentos: total por método de pagamento (pix, dinheiro, cartão).
- perdas: produtos baixados como perda.
- compras: entradas/compras por produto.
- estoque: saldo atual de estoque (ao vivo, ignora período).
- caixa: fechamentos de caixa (esperado x contado, quebra).
- abc: curva ABC por faturamento.

Regras: "mais vendidos" = fonte produtos, ordenarPor quantidade, ordem desc. "maior faturamento" = ordenarPor receita. "pior/menor margem" = ordenarPor margemPct, ordem asc. "margem abaixo de X%" = filtros.margemPctMax=X. Se o período não for citado, use "30d". Se pedirem "top N", use limite=N.`;

const insightSchema = z.object({ insight: z.string() });

export async function perguntarIA(pergunta: string): Promise<ResultadoIA | { erro: string }> {
  const texto = (pergunta ?? "").trim();
  if (texto.length < 3) return { erro: "Escreva uma pergunta." };
  if (texto.length > 400) return { erro: "Pergunta muito longa. Seja mais direto." };
  if (!llmConfigured()) return { erro: "IA não configurada neste ambiente. Defina a chave do provedor (ANTHROPIC_API_KEY ou GEMINI_API_KEY)." };

  const ctx = await requireActiveTenant();

  // 1+2. IA → DSL → validação Zod.
  let consulta: Consulta;
  try {
    const bruto = await completeJson<unknown>({ system: SYSTEM_DSL, user: texto });
    const parsed = consultaSchema.safeParse(bruto);
    if (!parsed.success) return { erro: "Não entendi a pergunta em um relatório válido. Tente reformular." };
    consulta = parsed.data;
  } catch {
    return { erro: "Falha ao interpretar a pergunta. Tente novamente." };
  }

  const periodo = resolvePeriodo({ periodo: consulta.periodo.preset, de: consulta.periodo.de, ate: consulta.periodo.ate });
  const range: Range = { inicio: periodo.inicio, fim: periodo.fim };

  // 3. Executa dentro do tenant.
  const resolvido = await withTenant(ctx, async () => resolverConsulta(consulta, range, await getActiveSiteId()));

  // 4. IA resume os números reais (cap de linhas p/ não estourar tokens).
  let insight = "";
  if (resolvido.totalLinhas === 0) {
    insight = "Nenhum dado encontrado para essa pergunta no período.";
  } else {
    try {
      const amostra = resolvido.brutas.slice(0, 40);
      const r = await completeJson<{ insight: string }>({
        system: "Você é analista de dados de um mercado. Escreva em português, 2-3 frases, um resumo com o insight principal dos dados fornecidos. Cite números reais dos dados. Não invente. Responda JSON: { \"insight\": \"...\" }.",
        user: `Pergunta do operador: "${texto}"\nDados (JSON):\n${JSON.stringify(amostra)}`,
      });
      insight = insightSchema.parse(r).insight;
    } catch {
      insight = "Dados carregados abaixo. (Não foi possível gerar o resumo automático.)";
    }
  }

  return {
    consulta,
    interpretacao: interpretar(consulta) + ` · emitido ${fmtDataCompleta(new Date())}`,
    colunas: resolvido.colunas,
    linhas: resolvido.linhas,
    totalLinhas: resolvido.totalLinhas,
    insight,
  };
}
