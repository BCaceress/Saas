import { z } from "zod";
import { podeEmAlguma } from "@/lib/permissoes";
import { getFato } from "@/lib/analises/catalogo";
import { executarConsulta, ConsultaInvalidaError, type ResultadoConsulta } from "@/lib/analises/motor";
import { consultaSchema } from "@/lib/analises/schema";
import type { CopilotoTool } from "../tipos";

/**
 * Embrulha o motor de análises (`analises/motor.ts`) fixando `fato: "venda-item"`
 * — único fato com carregador registrado hoje em `CATALOGO`. Quando
 * "movimento-estoque"/"posicao-estoque"/"caixa" ganharem carregador, esta tool
 * pode virar genérica sem mudar o resto do copiloto.
 */

const inputSchema = consultaSchema.omit({ fato: true }).extend({
  // Teto menor que o DSL cru (500): a resposta vira contexto de LLM, não CSV.
  limite: z.number().int().min(1).max(20).default(20),
});

type Input = z.infer<typeof inputSchema>;

function descricao(): string {
  const fato = getFato("venda-item")!;
  const dims = fato.dimensoes.map((d) => `${d.id} — ${d.descricao}`).join("; ");
  const mets = fato.metricas.map((m) => `${m.id} — ${m.descricao}`).join("; ");
  return (
    "Consulta vendas/faturamento do mercado, agregando por dimensões e métricas. " +
    `Dimensões disponíveis: ${dims}. Métricas disponíveis: ${mets}. ` +
    'Use "comparar": true para comparar com o período imediatamente anterior. ' +
    'Filtro por texto usa op "contem" (ex.: produto contém "Heineken").'
  );
}

function condensar(r: ResultadoConsulta) {
  return {
    periodo: r.periodo.label,
    colunas: r.colunas.map((c) => c.header),
    linhas: r.linhas.slice(0, 30),
    totais: r.totaisTexto,
    totalGrupos: r.totalGrupos,
    truncado: r.truncado || r.totalGrupos > 30,
    metricasRemovidas: r.metricasRemovidas,
  };
}

export const consultarVendasTool: CopilotoTool<Input> = {
  name: "consultarVendas",
  kind: "query",
  description: descricao(),
  inputSchema,
  handler: async (input, ctx) => {
    if (!podeEmAlguma(ctx.tenant.acessos, "relatorio.ver")) {
      return { ok: false, erro: "Sem permissão para ver relatórios de vendas." };
    }
    try {
      const resultado = await executarConsulta({
        consulta: { fato: "venda-item", ...input },
        acessos: ctx.tenant.acessos,
        siteId: ctx.siteId,
        policy: ctx.policy,
      });
      return { ok: true, conteudo: condensar(resultado) };
    } catch (e) {
      if (e instanceof ConsultaInvalidaError) return { ok: false, erro: e.message };
      throw e;
    }
  },
};
