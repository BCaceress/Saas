"use server";

import { z } from "zod";
import { withTenant } from "@/lib/current-tenant";
import { guardAction } from "@/lib/guard";
import { getActiveSiteId } from "@/lib/sites";
import { completeJson, llmConfigured } from "@/lib/llm";
import { db } from "@/lib/prisma";
import { brl } from "@/lib/utils";
import { vendasPorCategoria, vendasPorHora } from "../relatorios/_data";
import type { Insight } from "./_insights";
import type { InsightFeedbackAcao } from "@/generated/prisma";

/**
 * Camada IA opcional do Assistente (PRD "IA híbrida"): o texto de regra já
 * está na tela antes desta action ser chamada — aqui só pedimos pra IA
 * reescrever em linguagem mais natural, citando os MESMOS números. Se a IA
 * não estiver configurada ou falhar, devolve null e o cliente mantém o texto
 * de regra (fallback silencioso, sem erro visível pro operador).
 *
 * Cache em memória (por instância do servidor): o mesmo conjunto de insights,
 * no mesmo tenant, no mesmo dia, não precisa reprocessar a cada mount do
 * client component (ex.: navegação entre abas volta pro dashboard).
 */

const CACHE_TTL_MS = 15 * 60 * 1000;
const cachePolimento = new Map<string, { texto: string; expira: number }>();

function chaveCache(tenantId: string, insights: Pick<Insight, "titulo" | "corpo" | "tom">[]): string {
  const dia = new Date().toISOString().slice(0, 10);
  const assinatura = insights.map((i) => i.titulo).join("|");
  return `${tenantId}:${dia}:${assinatura}`;
}

const respostaSchema = z.object({ texto: z.string().min(1).max(600) });

export async function polirResumoAssistente(
  insights: Pick<Insight, "titulo" | "corpo" | "tom">[],
  resumo: { faturamento: number; margemBruta: number },
): Promise<string | null> {
  if (!llmConfigured() || insights.length === 0) return null;

  const ctx = await guardAction("relatorio.ver");
  const chave = chaveCache(ctx.tenant.id, insights);
  const emCache = cachePolimento.get(chave);
  if (emCache && emCache.expira > Date.now()) return emCache.texto;

  return withTenant(ctx, async () => {
    try {
      const r = await completeJson<{ texto: string }>({
        system:
          "Você é o copiloto de um ERP para operadores de mercado. Reescreva os pontos abaixo em português, " +
          "tom direto e profissional, 2-4 frases corridas (sem bullets, sem markdown). Cite os números reais " +
          "informados — nunca invente dado novo, nunca sugira algo que não esteja nos pontos. " +
          'Responda apenas JSON: { "texto": "..." }.',
        user: `Faturamento do período: ${brl(resumo.faturamento)}. Lucro bruto: ${brl(resumo.margemBruta)}.\nPontos encontrados:\n${insights
          .map((i) => `- [${i.tom}] ${i.titulo}: ${i.corpo}`)
          .join("\n")}`,
      });
      const texto = respostaSchema.parse(r).texto;
      cachePolimento.set(chave, { texto, expira: Date.now() + CACHE_TTL_MS });
      return texto;
    } catch {
      return null;
    }
  });
}

/**
 * Feedback do operador sobre um insight (aprendizado de priorização, ver
 * _insights.ts:ordenar). `insightId` é a CHAVE DA REGRA (ex.: "ticket"), não
 * uma instância — dispara e esquece, nunca bloqueia a interação do usuário.
 */
export async function registrarFeedbackInsight(insightId: string, acao: InsightFeedbackAcao): Promise<void> {
  const ctx = await guardAction("relatorio.ver");
  await withTenant(ctx, async () => {
    await db.insightFeedback.create({ data: { tenantId: ctx.tenant.id, insightId, acao } });
  });
}

/** Recorte de um dia clicado no gráfico de tendência — vendas por categoria + horário de pico. */
export type DetalheDia = {
  categorias: { categoria: string; valor: number; quantidade: number }[];
  picoHora: string | null;
};

export async function detalheDia(dataISO: string): Promise<DetalheDia | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataISO)) return null;

  const ctx = await guardAction("relatorio.ver");
  return withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const inicio = new Date(`${dataISO}T00:00:00`);
    const fim = new Date(inicio.getTime() + 86400000);
    const range = { inicio, fim };

    const [categorias, porHora] = await Promise.all([
      vendasPorCategoria(range, siteId),
      vendasPorHora(range, siteId),
    ]);

    const pico = porHora.reduce((a, b) => (b.valor > a.valor ? b : a), porHora[0] ?? { data: "", valor: 0 });

    return {
      categorias: categorias.slice(0, 4).map((c) => ({ categoria: c.categoria, valor: c.receita, quantidade: c.quantidade })),
      picoHora: pico.valor > 0 ? pico.data : null,
    };
  });
}

/**
 * Personalização de widgets (por usuário, por tenant). `db.dashboardWidgetPref`
 * é tabela de negócio — nunca `findUnique`/`upsert` direto (CLAUDE.md): busca
 * com `findFirst` e decide create/update na mão.
 */
export type DashboardWidgetPref = { hidden: string[]; ordem: string[] };

export async function getDashboardWidgetPref(): Promise<DashboardWidgetPref> {
  const ctx = await guardAction("relatorio.ver");
  return withTenant(ctx, async () => {
    const pref = await db.dashboardWidgetPref.findFirst({ where: { userId: ctx.user.id } });
    return { hidden: pref?.hidden ?? [], ordem: pref?.ordem ?? [] };
  });
}

export async function saveDashboardWidgetPref(hidden: string[], ordem: string[]): Promise<void> {
  const ctx = await guardAction("relatorio.ver");
  await withTenant(ctx, async () => {
    const existente = await db.dashboardWidgetPref.findFirst({ where: { userId: ctx.user.id } });
    if (existente) {
      await db.dashboardWidgetPref.update({ where: { id: existente.id }, data: { hidden, ordem } });
    } else {
      await db.dashboardWidgetPref.create({ data: { tenantId: ctx.tenant.id, userId: ctx.user.id, hidden, ordem } });
    }
  });
}
