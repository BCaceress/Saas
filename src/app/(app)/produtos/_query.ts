import { unstable_cache, revalidateTag } from "next/cache";
import type { Prisma, ProductType } from "@/generated/prisma";
import { db, basePrisma, comTenant } from "@/lib/prisma";
import { requireTenantId, runWithTenant } from "@/lib/tenant-context";
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

const num = (v: { toNumber: () => number } | null | undefined) => (v == null ? null : v.toNumber());

/** Compostos derivam custo e disponibilidade dos componentes, não têm os seus. */
const ehComposto = (t: ProductType) => t === "COMBO" || t === "PERSONALIZADO";

/**
 * Só os compostos, com o que `derive()` precisa. Diferente do antigo
 * `SELECT_LEVE`, que subia isto para o catálogo INTEIRO só para ordenar.
 */
const SELECT_COMPOSTO = {
  id: true,
  tipo: true,
  precoVenda: true,
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

type ProdutoComposto = Prisma.ProductGetPayload<{ select: typeof SELECT_COMPOSTO }>;

function derivadoDe(p: ProdutoComposto) {
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

/** Chave de ordenação de uma linha: número ordena por valor, texto por localeCompare. */
type Chave = number | string;

/** Sem valor vai para o fim do ASC — mesma convenção da versão anterior. */
const SEM_VALOR = Number.NEGATIVE_INFINITY;

/**
 * Chaves de ordenação calculadas NO BANCO, para as ordens que o `ORDER_BY` do
 * Prisma não alcança.
 *
 * Antes isto era feito em JS: um SELECT com stocks, suppliers e components
 * aninhados do catálogo inteiro, a cada clique de ordenar ou virar página,
 * amortizado por um `Map` de 30s que vivia no processo — ou seja, que em
 * serverless quase nunca acertava, porque a próxima requisição cai em outra
 * instância. Aqui sobe uma linha de duas colunas por produto.
 *
 * O WHERE continua sendo montado pelo Prisma (`whereDoFiltro`) e chega aqui
 * como lista de ids: a regra de filtro segue tendo UMA implementação.
 *
 * A lista de ids viaja como um parâmetro de texto virando jsonb pelo mesmo
 * motivo documentado em `carregarGiro` — `Prisma.join` quebra quando o bundler
 * carrega duas cópias do runtime.
 */
async function chavesNoBanco(ids: string[], sort: ProdutoSortField): Promise<Map<string, Chave>> {
  const mapa = new Map<string, Chave>();
  if (!ids.length) return mapa;

  const tid = requireTenantId();
  const idsJson = JSON.stringify(ids);

  if (sort === "margem") {
    // Espelha `margem()` de lib/utils: null quando falta preço ou custo, ou
    // quando o preço não é positivo.
    const linhas = await comTenant(
      tid,
      basePrisma.$queryRaw<{ id: string; chave: number | null }[]>`
        SELECT p.id,
               CASE WHEN p."precoVenda" > 0 AND p.custo IS NOT NULL
                    THEN round(((p."precoVenda" - p.custo) / p."precoVenda") * 100)
                    ELSE NULL END::float8 AS "chave"
          FROM "Product" p
         WHERE p."tenantId" = ${tid}
           AND p.id IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb))
      `,
    );
    for (const l of linhas) mapa.set(l.id, l.chave ?? SEM_VALOR);
    return mapa;
  }

  if (sort === "estoque") {
    // Espelha `stockQty` da tela: PERSONALIZADO e INSUMO sem meta não têm saldo
    // exibível. `MAX` em vez do "primeiro Stock" que o JS lia: o produto tem uma
    // linha de Stock por site (@@unique([productId, siteId])) e a versão antiga
    // pegava `stocks[0]` sem ORDER BY — ou seja, uma linha arbitrária. Com uma
    // loja só o resultado é idêntico; com várias, "alguma loja tem meta" é
    // determinístico, que a leitura anterior não era.
    const linhas = await comTenant(
      tid,
      basePrisma.$queryRaw<{ id: string; chave: number | null }[]>`
        SELECT p.id,
               CASE WHEN p.tipo = 'PERSONALIZADO'
                      OR (p.tipo = 'INSUMO'
                          AND COALESCE(MAX(s."estoqueMinimo"), 0) <= 0
                          AND COALESCE(MAX(s."estoqueIdeal"), 0) <= 0)
                    THEN NULL
                    ELSE COALESCE(SUM(s."estoqueFechado"), 0) END::float8 AS "chave"
          FROM "Product" p
          LEFT JOIN "Stock" s ON s."productId" = p.id AND s."tenantId" = p."tenantId"
         WHERE p."tenantId" = ${tid}
           AND p.id IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb))
         GROUP BY p.id, p.tipo
      `,
    );
    for (const l of linhas) mapa.set(l.id, l.chave ?? SEM_VALOR);
    return mapa;
  }

  if (sort === "fornecedor") {
    // `isPrincipal` primeiro, senão qualquer um — mesma escolha do JS anterior.
    const linhas = await comTenant(
      tid,
      basePrisma.$queryRaw<{ id: string; chave: string | null }[]>`
        SELECT p.id, lower(COALESCE(f."nomeFantasia", f."razaoSocial", '')) AS "chave"
          FROM "Product" p
          LEFT JOIN LATERAL (
            SELECT s."nomeFantasia", s."razaoSocial"
              FROM "ProductSupplier" ps
              JOIN "Supplier" s ON s.id = ps."supplierId"
             WHERE ps."productId" = p.id AND ps."tenantId" = p."tenantId"
             ORDER BY ps."isPrincipal" DESC
             LIMIT 1
          ) f ON TRUE
         WHERE p."tenantId" = ${tid}
           AND p.id IN (SELECT jsonb_array_elements_text(${idsJson}::jsonb))
      `,
    );
    for (const l of linhas) mapa.set(l.id, l.chave ?? "");
    return mapa;
  }

  // vendas / parado: o giro já era SQL — o desperdício era carregar o catálogo
  // ao lado dele sem precisar.
  const giro = await carregarGiro(ids);
  for (const id of ids) {
    mapa.set(
      id,
      sort === "vendas"
        ? giro[id]?.vendas30d ?? 0
        : // Nunca vendido é o mais parado de todos.
          giro[id]?.diasSemVenda ?? Number.MAX_SAFE_INTEGER,
    );
  }
  return mapa;
}

/**
 * Ids do filtro já na ordem pedida, para as ordens que o Postgres não resolve
 * com um `ORDER BY` simples.
 *
 * Três passos: o Prisma diz QUEM passa no filtro (id/tipo/nome, nada aninhado),
 * o banco calcula a chave de cada um, e `derive()` corrige os compostos — que
 * são os únicos cujo custo e disponibilidade não estão numa coluna.
 *
 * A ordenação final fica em JS de propósito: `localeCompare("pt-BR")` e o
 * desempate por nome são os mesmos de antes, sem depender do collation do banco.
 */
async function idsOrdenados(
  where: Prisma.ProductWhereInput,
  sort: ProdutoSortField,
  dir: ProdutoSortDir,
): Promise<string[]> {
  const alvos = await db.product.findMany({
    where,
    select: { id: true, nome: true, tipo: true },
  });
  if (!alvos.length) return [];

  const chaves = await chavesNoBanco(alvos.map((a) => a.id), sort);

  // Composto não tem custo nem saldo próprios: o valor vem dos componentes, e
  // quem sabe essa regra é `derive()`. Reimplementá-la em SQL criaria duas
  // versões da mesma conta, que divergem no primeiro ajuste de receita.
  if (sort === "margem" || sort === "estoque") {
    const idsCompostos = alvos.filter((a) => ehComposto(a.tipo)).map((a) => a.id);
    if (idsCompostos.length) {
      const compostos = await db.product.findMany({
        where: { id: { in: idsCompostos } },
        select: SELECT_COMPOSTO,
      });
      for (const c of compostos) {
        const d = derivadoDe(c);
        chaves.set(
          c.id,
          sort === "margem"
            ? margem(num(c.precoVenda), d.custoTotal) ?? SEM_VALOR
            : // Vale para COMBO **e** PERSONALIZADO. Tentador escrever aqui que
              // PERSONALIZADO "não tem saldo" como faz `stockQty` — mas lá a
              // checagem é código morto: composto sempre tem `disponibilidade`
              // derivada e sai no `if` anterior. Quem ordenar por estoque espera
              // a mesma posição que a coluna mostra.
              d.disponibilidade,
        );
      }
    }
  }

  return alvos
    .map((a) => ({ id: a.id, nome: a.nome, k: chaves.get(a.id) ?? SEM_VALOR }))
    .sort((a, b) => {
      const cmp =
        typeof a.k === "number" && typeof b.k === "number"
          ? a.k - b.k
          : String(a.k).localeCompare(String(b.k), "pt-BR");
      return (dir === "asc" ? cmp : -cmp) || a.nome.localeCompare(b.nome, "pt-BR");
    })
    .map((x) => x.id);
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

/** Tag de invalidação das opções de filtro — POR TENANT, nunca global. */
const tagOpcoesFiltro = (tenantId: string) => `produtos:opcoes:${tenantId}`;

/**
 * Derruba o cache das opções de filtro do tenant. Chamar depois de criar ou
 * renomear categoria, subcategoria, marca, etiqueta ou loja — é o que faz o
 * operador ver a marca recém-cadastrada no filtro sem esperar o revalidate.
 *
 * `{ expire: 0 }` e não `"max"`: o perfil `max` é stale-while-revalidate, ou
 * seja, quem acabou de cadastrar ainda veria a lista velha uma vez. Aqui o caso
 * é ler a própria escrita, então a entrada expira na hora e a próxima leitura
 * paga a consulta.
 */
export function invalidarOpcoesFiltro(tenantId: string) {
  revalidateTag(tagOpcoesFiltro(tenantId), { expire: 0 });
}

type OpcoesFiltroDados = {
  categoryOpts: CategoryFilterOpt[];
  subOpts: SubcategoryFilterOpt[];
  brandOpts: BrandOpt[];
  siteOpts: SiteOpt[];
  tagOpts: TagOpt[];
};

/**
 * Listas que alimentam os selects da barra de filtros. Ficam no LAYOUT, não na
 * página: layout não re-renderiza quando só a query string muda, então trocar
 * de filtro deixou de pagar quatro consultas que devolvem sempre o mesmo.
 *
 * Cacheadas porque categoria/marca/loja/etiqueta quase não mudam, e ainda assim
 * custavam quatro idas ao banco a cada entrada no módulo.
 *
 * ATENÇÃO ao mexer: `unstable_cache` monta a chave a partir dos ARGUMENTOS e
 * dos `keyParts`, e não enxerga o `AsyncLocalStorage` do tenant. Cachear a
 * versão que lê o tenant do contexto serviria a lista do tenant A para o tenant
 * B. Por isso o tenantId é parâmetro, entra na chave E abre o próprio
 * `runWithTenant` aqui dentro — as três coisas juntas, não uma delas.
 */
export function carregarOpcoesFiltro(tenantId: string): Promise<OpcoesFiltroDados> {
  return unstable_cache(
    () => runWithTenant(tenantId, consultarOpcoesFiltro),
    ["produtos", "opcoes-filtro", tenantId],
    // A tag cobre o caso normal (operador cadastra marca e quer vê-la no ato);
    // o revalidate é rede de segurança para escrita por um caminho que esqueceu
    // de invalidar — melhor 5 min de atraso que uma lista velha para sempre.
    { tags: [tagOpcoesFiltro(tenantId)], revalidate: 300 },
  )();
}

async function consultarOpcoesFiltro(): Promise<OpcoesFiltroDados> {
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
    const ordenados = await idsOrdenados(where, c.sort, c.dir);
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
    const ordenados = (await idsOrdenados(where, sort, dir)).slice(0, TETO_VARREDURA);
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
