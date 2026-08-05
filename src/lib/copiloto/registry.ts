import type { CopilotoTool } from "./tipos";
import { consultarVendasTool } from "./tools/vendas";
import { getRelatorioTool } from "./tools/relatorios";
import { compararFornecedoresTool } from "./tools/compras";

/** Erasa o `TInput` de cada tool concreta — o registry é heterogêneo de propósito. */
function tool<T>(t: CopilotoTool<T>): CopilotoTool<unknown> {
  return t as unknown as CopilotoTool<unknown>;
}

/**
 * Registry único de tools do copiloto. Adicionar tool de ação/navegação
 * (fases futuras) é só empurrar mais um item aqui — `agente.ts` já filtra por
 * `kind === "query"` na hora de montar o que o Claude enxerga.
 */
export const COPILOTO_TOOLS: CopilotoTool<unknown>[] = [
  tool(consultarVendasTool),
  tool(getRelatorioTool),
  tool(compararFornecedoresTool),
];

export function getCopilotoTool(name: string): CopilotoTool<unknown> | undefined {
  return COPILOTO_TOOLS.find((t) => t.name === name);
}
