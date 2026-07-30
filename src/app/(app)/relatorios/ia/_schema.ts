import type { ColunaResultado } from "@/lib/analises/motor";

/**
 * O que o assistente devolve para a tela.
 *
 * O DSL de consulta em si mora em `@/lib/analises/schema` — é o mesmo objeto
 * que a tela de consulta monta no clique, e o mesmo motor executa os dois. Aqui
 * só descrevemos a RESPOSTA: números que já saíram do motor, mais a leitura que
 * a IA fez deles.
 */

export type ResultadoIA = {
  /** Consulta codificada — abre a resposta na tela de consulta para ajustar. */
  q: string;
  /** Frase do que foi entendido, para o operador validar (ou corrigir). */
  interpretacao: string;
  colunas: ColunaResultado[];
  linhas: string[][];
  totalLinhas: number;
  /** Leitura em 2-3 frases sobre os números reais. Nunca inventa dado. */
  insight: string;
  /** Métricas cortadas por falta de `relatorio.financeiro`. */
  metricasRemovidas: string[];
};
