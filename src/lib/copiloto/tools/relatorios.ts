import { z } from "zod";
import { podeEmAlguma } from "@/lib/permissoes";
import { RELATORIOS, getRelatorio } from "@/lib/relatorios/catalogo";
import { getDefinicao, temDefinicao } from "@/lib/relatorios/definicoes";
import { normalizarConfig } from "@/lib/relatorios/config";
import { executarRelatorio } from "@/lib/relatorios/executar";
import type { CopilotoTool } from "../tipos";

/**
 * Embrulha o motor genérico de relatórios (`relatorios/executar.ts`). Cobre de
 * uma vez só todo relatório do catálogo que tem `ReportDefinition` — declarada
 * (inventário, margem, perdas, caixa…) ou derivada de uma consulta do motor de
 * análises — em vez de uma tool nova por relatório.
 */

const COM_DEFINICAO = RELATORIOS.filter((r) => temDefinicao(r.id));
const RELATORIO_IDS = COM_DEFINICAO.map((r) => r.id) as [string, ...string[]];

const inputSchema = z.object({
  relatorioId: z.enum(RELATORIO_IDS),
  /** Por id do filtro do relatório (ex.: "produto": "Heineken"). */
  filtros: z.record(z.string().max(40), z.union([z.string().max(160), z.number(), z.boolean()])).default({}),
  periodoPreset: z.enum(["hoje", "7d", "30d", "mes", "6m", "1a"]).default("30d"),
  limite: z.number().int().min(1).max(30).default(30),
});

type Input = z.infer<typeof inputSchema>;

function descricao(): string {
  const linhas = COM_DEFINICAO.map((r) => `${r.id} (${r.categoria}) — ${r.nome}: ${r.descricao}`);
  return (
    "Gera um relatório do catálogo do sistema, já filtrado e agregado. " +
    "Relatórios disponíveis (use o id exato em \"relatorioId\"):\n" +
    linhas.join("\n") +
    '\n\nPara filtrar por produto/fornecedor/categoria, passe o texto em "filtros" com o id do filtro do relatório (ex.: {"produto":"Heineken"}).'
  );
}

export const getRelatorioTool: CopilotoTool<Input> = {
  name: "getRelatorio",
  kind: "query",
  description: descricao(),
  inputSchema,
  handler: async (input, ctx) => {
    const rel = getRelatorio(input.relatorioId);
    if (!rel || !podeEmAlguma(ctx.tenant.acessos, rel.permissao)) {
      return { ok: false, erro: "Você não tem acesso a esse relatório." };
    }

    const def = getDefinicao(rel.id);
    if (!def) return { ok: false, erro: "Esse relatório só abre pela tela do sistema." };

    const config = normalizarConfig(def, {
      filtros: input.filtros,
      periodo: { preset: input.periodoPreset },
      colunas: [],
      limite: input.limite,
    });

    const resultado = await executarRelatorio({
      def,
      config,
      acessos: ctx.tenant.acessos,
      siteId: ctx.siteId,
      siteNome: ctx.siteNome,
      policy: ctx.policy,
    });

    return {
      ok: true,
      conteudo: {
        nome: resultado.nome,
        periodo: resultado.periodoLabel,
        colunas: resultado.colunas.map((c) => c.label),
        linhas: resultado.linhas.slice(0, 30),
        indicadores: resultado.indicadores,
        totais: resultado.totais,
        totalLinhas: resultado.totalLinhas,
        truncado: resultado.truncado || resultado.totalLinhas > 30,
      },
    };
  },
};
