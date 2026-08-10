import type { Prisma, ProductType } from "@/generated/prisma";
import { db, basePrisma, comTenant } from "@/lib/prisma";
import { requireTenantId } from "@/lib/tenant-context";
import { derive, type DeriveComponent } from "@/lib/derive";
import { margem } from "@/lib/utils";
import { PRODUCT_INCLUDE, toProductRow } from "./_data";
import {
  SEM_MARCA,
  SEM_TAG,
  type BrandOpt,
  type CategoryFilterOpt,
  type ProductRow,
  type ProdutoConsulta,
  type ProdutoFiltro,
  type ProdutoGiro,
  type ProdutoSortDir,
  type ProdutoSortField,
  type ProdutosPagina,
  type ProdutoVisao,
  type SiteOpt,
  type SubcategoryFilterOpt,
  type TagOpt,
} from "./_types";

/**
 * Consulta da listagem de /produtos — filtro, ordenação e paginação no BANCO.
 *
 * Antes a página trazia o catálogo inteiro (com stocks, packagings, suppliers e
 * components de cada linha) e filtrava no browser: a 2.000 produtos isso é
 * megabytes de payload RSC a cada navegação. Aqui só a página pedida sobe.
 */

const DIA_MS = 24 * 60 * 60 * 1000;
/** Teto do export/seleção total — evita transformar um clique em varredura infinita. */
export const TETO_VARREDURA = 5000;

export const FILTRO_VAZIO: ProdutoFiltro = {
  q: "",
  tipo: "",
  sub: "",
  marca: "",
  fornecedorId: "",
  siteId: "",
  tag: "",
  status: "ativos",
  flags: {
    semPreco: false, semImagem: false, semEan: false, semFiscal: false,
    online: false, maiorIdade: false,
  },
};

// ── WHERE ────────────────────────────────────────────────────────────────────

export function whereDoFiltro(f: ProdutoFiltro): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [];

  const termo = f.q.trim();
  if (termo) {
    and.push({
      OR: [
        { nome: { contains: termo, mode: "insensitive" } },
        { sku: { contains: termo, mode: "insensitive" } },
        { ean: { contains: termo } },
        // O operador bipa o fardo tanto quanto a unidade.
        { packagings: { some: { ean: { contains: termo } } } },
      ],
    });
  }

  if (f.tipo) and.push({ tipo: f.tipo as ProductType });

  if (f.sub) {
    if (f.sub.startsWith("cat:")) and.push({ subcategory: { categoryId: f.sub.slice(4) } });
    else and.push({ subcategoryId: f.sub });
  }

  if (f.marca === SEM_MARCA) and.push({ brandId: null });
  else if (f.marca) and.push({ brandId: f.marca });

  if (f.fornecedorId) and.push({ suppliers: { some: { supplierId: f.fornecedorId } } });

  // "O que existe na Loja 2": posição de estoque naquela loja, mesmo zerada —
  // saldo zero num produto que a loja trabalha é informação, não ausência.
  if (f.siteId) and.push({ stocks: { some: { siteId: f.siteId } } });

  if (f.tag === SEM_TAG) and.push({ tags: { none: {} } });
  else if (f.tag) and.push({ tags: { some: { tagId: f.tag } } });

  if (f.status === "ativos") and.push({ ativo: true });
  else if (f.status === "inativos") and.push({ ativo: false });

  // INSUMO não vende, então "sem preço" nele não é problema de cadastro.
  if (f.flags.semPreco) and.push({ precoVenda: null, tipo: { not: "INSUMO" } });
  if (f.flags.semImagem) and.push({ imagemUrl: null });
  if (f.flags.semEan) and.push({ ean: null });
  if (f.flags.semFiscal) and.push({ fiscalProfileId: null });
  if (f.flags.online) and.push({ vendeOnline: true });
  if (f.flags.maiorIdade) and.push({ restricaoIdade: true });

  return and.length ? { AND: and } : {};
}

// ── Ordenação ────────────────────────────────────────────────────────────────

/**
 * Ordens que o Postgres resolve sozinho. As demais (margem, estoque,
 * fornecedor, giro) são derivadas em código — caem no caminho de duas fases.
 */
const ORDER_DB: Partial<
  Record<ProdutoSortField, (d: ProdutoSortDir) => Prisma.ProductOrderByWithRelationInput[]>
> = {
  nome: (d) => [{ nome: d }],
  marca: (d) => [{ brand: { nome: d } }, { nome: "asc" }],
  tipo: (d) => [{ tipo: d }, { nome: "asc" }],
  categoria: (d) => [
    { subcategory: { category: { nome: d } } },
    { subcategory: { nome: d } },
    { nome: "asc" },
  ],
  preco: (d) => [{ precoVenda: { sort: d, nulls: "last" } }, { nome: "asc" }],
};

/** Só o que as ordens derivadas precisam — bem mais leve que PRODUCT_INCLUDE. */
const SELECT_LEVE = {
  id: true,
  nome: true,
  tipo: true,
  precoVenda: true,
  custo: true,
  conteudoPorUnidade: true,
  stocks: {
    select: {
      estoqueFechado: true,
      estoqueAberto: true,
      estoqueMinimo: true,
      estoqueIdeal: true,
    },
  },
  suppliers: {
    select: {
      isPrincipal: true,
      supplier: { select: { nomeFantasia: true, razaoSocial: true } },
    },
  },
  components: {
    select: {
      quantidade: true,
      unidade: true,
      component: {
        select: {
          custo: true,
          precoVenda: true,
          conteudoPorUnidade: true,
          stocks: { select: { estoqueFechado: true, estoqueAberto: true } },
        },
      },
    },
  },
} satisfies Prisma.ProductSelect;

type ProdutoLeve = Prisma.ProductGetPayload<{ select: typeof SELECT_LEVE }>;

const num = (v: { toNumber: () => number } | null | undefined) => (v == null ? null : v.toNumber());

function derivadoDe(p: ProdutoLeve) {
  if (p.tipo !== "COMBO" && p.tipo !== "PERSONALIZADO") return null;
  const comps: DeriveComponent[] = p.components.map((c) => ({
    quantidade: num(c.quantidade) ?? 0,
    unidade: c.unidade,
    custo: num(c.component.custo),
    precoVenda: num(c.component.precoVenda),
    conteudoPorUnidade: num(c.component.conteudoPorUnidade),
    estoqueFechado: c.component.stocks.reduce((s, st) => s + Number(st.estoqueFechado), 0),
    estoqueAberto: c.component.stocks.reduce((s, st) => s + Number(st.estoqueAberto), 0),
  }));
  return derive(comps);
}

/** Mesma regra de `stockQty` da tela: null = produto sem controle de estoque. */
function saldoDe(p: ProdutoLeve, disponibilidadeDerivada: number | null): number | null {
  if (disponibilidadeDerivada !== null) return disponibilidadeDerivada;
  const minimo = num(p.stocks[0]?.estoqueMinimo) ?? 0;
  const ideal = num(p.stocks[0]?.estoqueIdeal) ?? 0;
  if (p.tipo === "PERSONALIZADO" || (p.tipo === "INSUMO" && minimo <= 0 && ideal <= 0)) return null;
  return p.stocks.reduce((s, st) => s + Number(st.estoqueFechado), 0);
}

/**
 * Cache curtíssimo da ordenação derivada. Sem ele, virar a página com "ordenar
 * por margem" varre o catálogo inteiro de novo a cada clique. 30s é menos que o
 * tempo de olhar uma página e ainda assim cobre a paginação inteira.
 */
const CACHE_ORDEM_MS = 30_000;
const cacheOrdem = new Map<string, { em: number; ids: string[] }>();

function lerCacheOrdem(chave: string): string[] | null {
  const hit = cacheOrdem.get(chave);
  if (!hit) return null;
  if (Date.now() - hit.em > CACHE_ORDEM_MS) {
    cacheOrdem.delete(chave);
    return null;
  }
  return hit.ids;
}

function gravarCacheOrdem(chave: string, ids: string[]) {
  // Teto de entradas: o Map vive no processo e não pode virar vazamento.
  if (cacheOrdem.size > 50) {
    for (const k of cacheOrdem.keys()) {
      cacheOrdem.delete(k);
      if (cacheOrdem.size <= 25) break;
    }
  }
  cacheOrdem.set(chave, { em: Date.now(), ids });
}

/**
 * Ids do filtro já na ordem pedida, para as ordenações derivadas. Duas fases:
 * um SELECT leve ordena tudo, depois só a fatia da página vira linha completa.
 */
async function idsOrdenadosEmMemoria(
  where: Prisma.ProductWhereInput,
  sort: ProdutoSortField,
  dir: ProdutoSortDir,
): Promise<string[]> {
  const chave = `${requireTenantId()}|${sort}|${dir}|${JSON.stringify(where)}`;
  const doCache = lerCacheOrdem(chave);
  if (doCache) return doCache;

  const leves = await db.product.findMany({ where, select: SELECT_LEVE });

  const giro =
    sort === "vendas" || sort === "parado"
      ? await carregarGiro(leves.map((p) => p.id))
      : {};

  const chaveDe = (p: ProdutoLeve): number | string => {
    const d = derivadoDe(p);
    switch (sort) {
      case "margem": {
        const custo = d ? d.custoTotal : num(p.custo);
        return margem(num(p.precoVenda), custo) ?? Number.NEGATIVE_INFINITY;
      }
      case "estoque":
        return saldoDe(p, d ? d.disponibilidade : null) ?? Number.NEGATIVE_INFINITY;
      case "fornecedor": {
        const principal = p.suppliers.find((s) => s.isPrincipal) ?? p.suppliers[0];
        const s = principal?.supplier;
        return (s ? s.nomeFantasia ?? s.razaoSocial : "").toLowerCase();
      }
      case "vendas":
        return giro[p.id]?.vendas30d ?? 0;
      case "parado":
        // Nunca vendido é o mais parado de todos.
        return giro[p.id]?.diasSemVenda ?? Number.MAX_SAFE_INTEGER;
      default:
        return p.nome.toLowerCase();
    }
  };

  const ordenados = leves
    .map((p) => ({ id: p.id, k: chaveDe(p), nome: p.nome }))
    .sort((a, b) => {
      const cmp =
        typeof a.k === "number" && typeof b.k === "number"
          ? a.k - b.k
          : String(a.k).localeCompare(String(b.k), "pt-BR");
      return (dir === "asc" ? cmp : -cmp) || a.nome.localeCompare(b.nome, "pt-BR");
    })
    .map((x) => x.id);

  gravarCacheOrdem(chave, ordenados);
  return ordenados;
}

// ── Giro (vendas 30d / dias sem venda) ───────────────────────────────────────

/**
 * Uma ida ao banco para todos os produtos da página. `SaleItem` não guarda data
 * — quem tem é `Sale` —, então não dá para resolver com `groupBy` do Prisma:
 * é SQL cru, com o tenantId explícito no WHERE (raw não passa pelo extension).
 *
 * A lista de ids viaja como UM parâmetro de texto virando jsonb, não como
 * `Prisma.join`: o bundler do Next pode carregar duas cópias do runtime do
 * Prisma, o `instanceof Sql` falha entre elas e o fragmento acaba enviado como
 * parâmetro jsonb ("operator does not exist: text = jsonb"). String simples
 * não tem esse problema.
 */
export async function carregarGiro(ids: string[]): Promise<Record<string, ProdutoGiro>> {
  if (!ids.length) return {};
  const tid = requireTenantId();
  const desde = new Date(Date.now() - 30 * DIA_MS);
  const idsJson = JSON.stringify(ids);

  const linhas = await comTenant(
    tid,
    basePrisma.$queryRaw<{ productId: string; vendas: number; ultima: Date | null }[]>`
      SELECT si."productId"                                                      AS "productId",
             COALESCE(SUM(CASE WHEN s."paidAt" >= ${desde}
                               THEN si.quantidade ELSE 0 END), 0)::float8        AS "vendas",
             MAX(s."paidAt")                                                     AS "ultima"
        FROM "SaleItem" si
        JOIN "Sale" s ON s.id = si."saleId"
       WHERE si."tenantId" = ${tid}
         AND s.status = 'PAGA'
         AND si."productId" IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb))
       GROUP BY si."productId"
    `,
  );

  const mapa: Record<string, ProdutoGiro> = {};
  for (const l of linhas) {
    mapa[l.productId] = {
      vendas30d: Number(l.vendas) || 0,
      diasSemVenda: l.ultima ? Math.floor((Date.now() - l.ultima.getTime()) / DIA_MS) : null,
    };
  }
  return mapa;
}


// ── Opções dos filtros ───────────────────────────────────────────────────────

/**
 * Listas que alimentam os selects da barra de filtros. Ficam no LAYOUT, não na
 * página: layout não re-renderiza quando só a query string muda, então trocar
 * de filtro deixou de pagar quatro consultas que devolvem sempre o mesmo.
 */
export async function carregarOpcoesFiltro(): Promise<{
  categoryOpts: CategoryFilterOpt[];
  subOpts: SubcategoryFilterOpt[];
  brandOpts: BrandOpt[];
  siteOpts: SiteOpt[];
  tagOpts: TagOpt[];
}> {
  const [categories, brands, sites, tags] = await Promise.all([
    db.category.findMany({
      orderBy: { nome: "asc" },
      select: {
        id: true,
        nome: true,
        subcategories: {
          where: { ativo: true },
          orderBy: { nome: "asc" },
          select: { id: true, nome: true },
        },
      },
    }),
    db.brand.findMany({ orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
    db.site.findMany({
      where: { ativo: true },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true },
    }),
    db.tag.findMany({ orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
  ]);

  return {
    categoryOpts: categories.map((c) => ({ id: c.id, nome: c.nome })),
    subOpts: categories.flatMap((c) =>
      c.subcategories.map((s) => ({
        id: s.id,
        nome: s.nome,
        categoriaNome: c.nome,
        categoryId: c.id,
      })),
    ),
    brandOpts: brands,
    siteOpts: sites,
    tagOpts: tags,
  };
}

// ── Visões salvas ────────────────────────────────────────────────────────────

/**
 * Visões do usuário + as da loja (sem dono). A visão é do operador, não da
 * máquina: quem monta "Parados 60d" no balcão precisa achá-la no escritório.
 */
export async function listarVisoes(userId: string): Promise<ProdutoVisao[]> {
  const linhas = await db.productView.findMany({
    where: { OR: [{ userId }, { userId: null }] },
    orderBy: { nome: "asc" },
    select: { id: true, nome: true, params: true, userId: true },
  });
  return linhas.map((v) => ({ id: v.id, nome: v.nome, params: v.params, minha: v.userId === userId }));
}

// ── Consulta principal ───────────────────────────────────────────────────────

export async function consultarProdutos(c: ProdutoConsulta): Promise<ProdutosPagina> {
  const where = whereDoFiltro(c);
  const porPagina = Math.min(Math.max(c.porPagina || 50, 1), 200);
  const ordemDb = ORDER_DB[c.sort]?.(c.dir);

  const [total, totalGeral] = await Promise.all([
    db.product.count({ where }),
    db.product.count({}),
  ]);

  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const pagina = Math.min(Math.max(c.pagina || 1, 1), totalPaginas);
  const skip = (pagina - 1) * porPagina;

  let brutos: Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>[];
  if (ordemDb) {
    brutos = await db.product.findMany({
      where,
      orderBy: ordemDb,
      skip,
      take: porPagina,
      include: PRODUCT_INCLUDE,
    });
  } else {
    const ordenados = await idsOrdenadosEmMemoria(where, c.sort, c.dir);
    const idsPagina = ordenados.slice(skip, skip + porPagina);
    const fatia = idsPagina.length
      ? await db.product.findMany({ where: { id: { in: idsPagina } }, include: PRODUCT_INCLUDE })
      : [];
    const pos = new Map(idsPagina.map((id, i) => [id, i]));
    brutos = fatia.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
  }

  const rows: ProductRow[] = brutos.map((p) => toProductRow(p));
  const giro = await carregarGiro(rows.map((r) => r.id));

  return { rows, giro, total, totalGeral };
}

/** Ids de tudo que bate com o filtro — alimenta "selecionar todos os N". */
export async function idsDoFiltro(f: ProdutoFiltro): Promise<string[]> {
  const alvos = await db.product.findMany({
    where: whereDoFiltro(f),
    select: { id: true },
    take: TETO_VARREDURA,
  });
  return alvos.map((a) => a.id);
}

/** Linhas completas do filtro inteiro, na ordem da tela — usado pelo export. */
export async function linhasDoFiltro(
  f: ProdutoFiltro,
  sort: ProdutoSortField,
  dir: ProdutoSortDir,
): Promise<{ rows: ProductRow[]; giro: Record<string, ProdutoGiro> }> {
  const where = whereDoFiltro(f);
  const ordemDb = ORDER_DB[sort]?.(dir);

  let brutos: Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>[];
  if (ordemDb) {
    brutos = await db.product.findMany({
      where,
      orderBy: ordemDb,
      take: TETO_VARREDURA,
      include: PRODUCT_INCLUDE,
    });
  } else {
    const ordenados = (await idsOrdenadosEmMemoria(where, sort, dir)).slice(0, TETO_VARREDURA);
    const fatia = ordenados.length
      ? await db.product.findMany({ where: { id: { in: ordenados } }, include: PRODUCT_INCLUDE })
      : [];
    const pos = new Map(ordenados.map((id, i) => [id, i]));
    brutos = fatia.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
  }

  const rows = brutos.map((p) => toProductRow(p));
  return { rows, giro: await carregarGiro(rows.map((r) => r.id)) };
}

/** Linhas de ids avulsos (seleção em lote que atravessa páginas). */
export async function linhasPorIds(ids: string[]): Promise<ProductRow[]> {
  const unicos = [...new Set(ids)].slice(0, TETO_VARREDURA);
  if (!unicos.length) return [];
  const brutos = await db.product.findMany({
    where: { id: { in: unicos } },
    orderBy: { nome: "asc" },
    include: PRODUCT_INCLUDE,
  });
  return brutos.map((p) => toProductRow(p));
}
