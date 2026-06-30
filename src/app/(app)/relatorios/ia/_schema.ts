import { z } from "zod";

/**
 * DSL de consulta de relatório (Fase 7 §12). A IA NUNCA escreve SQL — ela só
 * preenche este objeto, que é validado por Zod e executado por um resolver que
 * usa `db` (tenant já injetado). Isso garante isolamento multi-tenant e impede
 * que prompt injection vire query arbitrária no banco.
 */

export const FONTES = [
  "produtos", // ranking de produtos vendidos (receita, custo, margem, qtd)
  "categorias", // vendas agregadas por categoria
  "pagamentos", // mix por método de pagamento
  "perdas", // perdas por produto
  "compras", // entradas por produto
  "estoque", // posição de estoque ao vivo
  "caixa", // fechamentos de caixa
  "abc", // curva ABC
] as const;

export const CAMPOS_ORDEM = ["receita", "margem", "margemPct", "quantidade", "custo", "valor"] as const;

export const consultaSchema = z.object({
  fonte: z.enum(FONTES),
  periodo: z
    .object({
      preset: z.enum(["hoje", "7d", "30d", "mes", "custom"]).default("30d"),
      de: z.string().optional(),
      ate: z.string().optional(),
    })
    .default({ preset: "30d" }),
  ordenarPor: z.enum(CAMPOS_ORDEM).optional(),
  ordem: z.enum(["asc", "desc"]).default("desc"),
  limite: z.number().int().min(1).max(100).default(20),
  filtros: z
    .object({
      categoria: z.string().optional(),
      margemPctMin: z.number().optional(),
      margemPctMax: z.number().optional(),
      receitaMin: z.number().optional(),
      quantidadeMin: z.number().optional(),
    })
    .optional(),
});

export type Consulta = z.infer<typeof consultaSchema>;

export type ResultadoIA = {
  consulta: Consulta;
  /** Frase legível do que foi interpretado, para o usuário validar. */
  interpretacao: string;
  colunas: { header: string; align?: "right" }[];
  linhas: string[][];
  totalLinhas: number;
  insight: string;
};
