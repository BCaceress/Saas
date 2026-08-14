import type {
  ProdutoConsulta,
  ProdutoFiltro,
  ProdutoSortDir,
  ProdutoSortField,
} from "./_types";

/**
 * Tradução URL ⇄ consulta da listagem. Puro (sem DB, sem React) porque os dois
 * lados precisam: o RSC lê a URL para a primeira página, o cliente escreve nela
 * a cada mudança. Link de /produtos é bookmarkável e compartilhável — é assim
 * que o operador manda "olha esses aqui" para o colega.
 */

const SORTS: ProdutoSortField[] = [
  "nome", "marca", "tipo", "categoria", "preco",
  "margem", "estoque", "fornecedor", "vendas", "parado",
];

export const SORT_PADRAO: ProdutoSortField = "nome";
export const DIR_PADRAO: ProdutoSortDir = "asc";
export const POR_PAGINA_PADRAO = 50;
export const STATUS_PADRAO = "ativos";

export type Params = Record<string, string | string[] | undefined>;

const str = (p: Params, k: string): string => {
  const v = p[k];
  return (Array.isArray(v) ? v[0] : v) ?? "";
};

export function lerConsulta(p: Params, fornecedorIdInicial?: string): ProdutoConsulta {
  const fornecedorId = str(p, "fornecedorId") || fornecedorIdInicial || "";
  return {
    q: str(p, "q"),
    tipo: str(p, "tipo"),
    sub: str(p, "sub"),
    marca: str(p, "marca"),
    fornecedorId,
    siteId: str(p, "loja"),
    tag: str(p, "tag"),
    status: str(p, "status") || STATUS_PADRAO,
    flags: {
      semImagem: str(p, "f_semImagem") === "1",
      semEan: str(p, "f_semEan") === "1",
      semFiscal: str(p, "f_semFiscal") === "1",
      online: str(p, "f_online") === "1",
      maiorIdade: str(p, "f_maiorIdade") === "1",
    },
    sort: (SORTS.includes(str(p, "sort") as ProdutoSortField)
      ? (str(p, "sort") as ProdutoSortField)
      : SORT_PADRAO),
    dir: str(p, "dir") === "desc" ? "desc" : DIR_PADRAO,
    pagina: Number(str(p, "pg")) || 1,
    porPagina: Number(str(p, "pp")) || POR_PAGINA_PADRAO,
  };
}

/** Só o que difere do padrão entra na URL — link curto continua legível. */
export function consultaParaParams(c: ProdutoConsulta): URLSearchParams {
  const p = new URLSearchParams();
  if (c.q) p.set("q", c.q);
  if (c.tipo) p.set("tipo", c.tipo);
  if (c.sub) p.set("sub", c.sub);
  if (c.marca) p.set("marca", c.marca);
  if (c.fornecedorId) p.set("fornecedorId", c.fornecedorId);
  if (c.siteId) p.set("loja", c.siteId);
  if (c.tag) p.set("tag", c.tag);
  if (c.status !== STATUS_PADRAO) p.set("status", c.status);
  (Object.keys(c.flags) as (keyof ProdutoFiltro["flags"])[]).forEach((k) => {
    if (c.flags[k]) p.set(`f_${k}`, "1");
  });
  if (c.sort !== SORT_PADRAO) p.set("sort", c.sort);
  if (c.dir !== DIR_PADRAO) p.set("dir", c.dir);
  if (c.porPagina !== POR_PAGINA_PADRAO) p.set("pp", String(c.porPagina));
  if (c.pagina > 1) p.set("pg", String(c.pagina));
  return p;
}

/** Parte de filtro da consulta — o que as ações de seleção/export precisam. */
export function soFiltro(c: ProdutoConsulta): ProdutoFiltro {
  return {
    q: c.q,
    tipo: c.tipo,
    sub: c.sub,
    marca: c.marca,
    fornecedorId: c.fornecedorId,
    siteId: c.siteId,
    tag: c.tag,
    status: c.status,
    flags: c.flags,
  };
}

/** Quantos filtros estão em pé — alimenta o "Limpar (n)" e os chips. */
export function contarFiltros(c: ProdutoFiltro): number {
  return (
    (c.q ? 1 : 0) +
    (c.tipo ? 1 : 0) +
    (c.sub ? 1 : 0) +
    (c.marca ? 1 : 0) +
    (c.fornecedorId ? 1 : 0) +
    (c.siteId ? 1 : 0) +
    (c.tag ? 1 : 0) +
    (c.status !== STATUS_PADRAO ? 1 : 0) +
    Object.values(c.flags).filter(Boolean).length
  );
}
