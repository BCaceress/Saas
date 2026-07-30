import type { EstoquePolicy } from "@/lib/estoque-estrategia";
import type { Granularidade, Range } from "../schema";

/**
 * Contrato entre o motor e os carregadores de fato.
 *
 * O carregador devolve linhas no GRÃO do fato (um item vendido, um movimento,
 * um saldo) já resolvidas: cada dimensão vira texto, cada campo somável vira
 * número. Quem agrupa, calcula derivadas, ordena e corta é o motor — o
 * carregador só sabe ler o banco.
 */

export type LinhaFato = {
  /**
   * Valor de cada dimensão. Para dimensões ordenáveis (tempo, dia da semana) o
   * valor é a CHAVE ordenável (`2026-07-29`, `1`); o rótulo bonito é montado
   * na formatação, para que ordenar por tempo não vire ordem alfabética.
   */
  dims: Record<string, string | null>;
  /** Campos somáveis (`receita`, `cmv`, …). Ausente = 0. */
  vals: Record<string, number>;
  /** Chaves para contagem distinta (`venda` → saleId). */
  chaves?: Record<string, string>;
};

export type CarregarArgs = {
  range: Range;
  /** Lojas a considerar. null = todas as que o operador pode ver. */
  siteIds: string[] | null;
  /**
   * Tudo que o motor vai usar: dimensões pedidas, campos citados nos filtros e
   * campos somáveis das métricas. O carregador só busca (e só faz JOIN de) o
   * que estiver aqui — pedir "receita por produto" não vai atrás de cliente.
   */
  campos: Set<string>;
  granularidade: Granularidade;
  policy: EstoquePolicy;
  /** Teto de linhas a ler. Estourou, devolve `truncado: true`. */
  limite: number;
};

export type ResultadoFato = {
  linhas: LinhaFato[];
  truncado: boolean;
};

export type Carregador = (args: CarregarArgs) => Promise<ResultadoFato>;
