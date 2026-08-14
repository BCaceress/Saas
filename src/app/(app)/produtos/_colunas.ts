/**
 * Configuração de colunas/informativos da listagem de produtos.
 *
 * Mora fora de `_client.tsx` porque o esqueleto (`_skeleton.tsx`, usado pelo
 * `loading.tsx` — Server Component) precisa das mesmas larguras e da mesma
 * ordem. Se o esqueleto adivinhasse as colunas, a tabela pularia quando os
 * dados chegassem.
 */

export type ColKey =
  | "marca" | "tipo" | "categoria" | "local" | "margem" | "fornecedor" | "estoque"
  | "vendas" | "parado";

export const COL_ORDER: ColKey[] = [
  "marca", "tipo", "categoria", "local", "margem", "fornecedor", "estoque", "vendas", "parado",
];

export const COL_LABEL: Record<ColKey, string> = {
  marca: "Marca", tipo: "Tipo", categoria: "Categoria", local: "Local de estoque",
  margem: "Margem", fornecedor: "Fornecedor", estoque: "Estoque",
  vendas: "Vendas 30d", parado: "Parado há",
};

export const DEFAULT_COLS: Record<ColKey, boolean> = {
  marca: false, tipo: true, categoria: true, local: false,
  margem: true, fornecedor: true, estoque: true, vendas: false, parado: false,
};

/**
 * Largura + breakpoint de cada coluna — a MESMA string usada no `<th>` real da
 * tabela em `_client.tsx`. Fonte única: mudou aqui, muda no esqueleto junto.
 */
export const COL_TH_CLASS: Record<ColKey, string> = {
  marca: "hidden w-36 xl:table-cell",
  tipo: "hidden w-28 lg:table-cell",
  categoria: "hidden w-44 lg:table-cell",
  local: "hidden w-36 lg:table-cell",
  margem: "hidden w-24 sm:table-cell",
  fornecedor: "hidden w-40 md:table-cell",
  estoque: "w-28",
  vendas: "hidden w-24 lg:table-cell",
  parado: "hidden w-24 lg:table-cell",
};

/** compact = tabela · denso = tabela sem foto e sem respiro · cozy = grade de cards. */
export type Density = "cozy" | "compact" | "denso";

// ── Informativos (badges auxiliares, independentes de coluna) ───────────────
export type InfoKey = "restricao" | "sku";
export const INFO_ORDER: InfoKey[] = ["restricao", "sku"];
export const INFO_LABEL: Record<InfoKey, string> = { restricao: "Restrição +18", sku: "SKU" };
export const DEFAULT_INFO: Record<InfoKey, boolean> = { restricao: true, sku: true };
