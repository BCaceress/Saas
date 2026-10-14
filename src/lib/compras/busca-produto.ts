import "server-only";
import { basePrisma, comTenant, db } from "@/lib/prisma";
import { requireTenantId } from "@/lib/tenant-context";
import { urlImagemProduto } from "@/lib/imagem";
import { onlyDigits, semAcento } from "@/lib/normalize";
import {
  alternativasComEmbalagem,
  alternativasPorCodigo,
} from "@/lib/produto-codigo";
import { ordenarPorRelevancia, tokensDaBusca } from "./busca-produto-rank";
import { Prisma } from "@/generated/prisma";

// ============================================================
// Busca de produto para relacionar um item de nota ao catálogo.
//
// Três correções sobre o `contains` ingênuo:
//
//  1. procura PALAVRA A PALAVRA. "CERV HEINEKEN LN" não existe como frase em
//     "Cerveja Heineken Long Neck 330ml" — mas as três palavras existem.
//  2. NÃO EXIGE O TEXTO IGUAL. Entram também os nomes PARECIDOS (trigramas do
//     pg_trgm, sem acento) e os que têm só parte das palavras: "hortela",
//     "heinekn" e a palavra que o fornecedor abreviou diferente ainda acham o
//     produto. Antes, uma palavra a mais na descrição da nota zerava a lista.
//  3. traz mais linhas do que mostra e ORDENA POR RELEVÂNCIA. Ordenar por nome
//     no banco com LIMIT chega a cortar fora justamente o produto certo.
//
// E a foto não viaja: a coluna pode guardar a imagem inteira como `data:`, e
// trazê-la a cada tecla deixava a busca lenta. A lista leva só o caminho da
// foto, que o navegador baixa depois, com cache.
//
// Assume contexto de tenant ativo (runWithTenant no chamador).
// ============================================================

export type ProdutoBuscado = {
  id: string;
  nome: string;
  sku: string;
  ean: string | null;
  imagemUrl: string | null;
  custoMedio: number;
  /**
   * Unidade de MEDIDA do produto (UN, ML, G). Não confundir com o que entra no
   * estoque numa compra: entrada soma `estoqueFechado`, que conta unidades
   * fechadas (garrafas, latas) mesmo num produto medido em ml. O ML só aparece
   * no saldo ABERTO, quando alguém abre uma garrafa para usar em receita.
   */
  unidadeBase: string;
  /** Quanto cabe numa unidade fechada, na `unidadeBase` (1000 ml na garrafa). */
  conteudoPorUnidade: number | null;
  /** Marca — o que separa dois produtos de mesmo nome e mesmo volume. */
  marca: string | null;
  /** Códigos da unidade de venda — o principal e os apelidos de outras marcas. */
  codigos: { codigo: string }[];
  embalagens: { id: string; nome: string; ean: string | null; fator: number }[];
  /**
   * Saldo FECHADO — garrafas, latas, caixas inteiras. É o que responde "é este
   * mesmo?" quando dois produtos do catálogo têm nomes quase iguais, e é a
   * mesma grandeza que a compra soma.
   *
   * Não inclui o saldo aberto de propósito: somar 12 garrafas com 500 ml daria
   * 512 de coisa nenhuma.
   */
  saldo: number;
  /**
   * Última entrada deste produto (do mesmo fornecedor, quando informado).
   * Custo por unidade base — comparável com o que a nota atual traz.
   */
  ultimaCompra: { data: string; custoUnitario: number; doMesmoFornecedor: boolean } | null;
};

/** Quantas linhas o banco entrega para o ranqueamento escolher. */
const CANDIDATOS = 60;

/** Tirar acento no próprio banco, sem depender da extensão `unaccent`. */
const COM_ACENTO = "áàâãäåéèêëíìîïóòôõöúùûüçñ";
const SEM_ACENTO = "aaaaaaeeeeiiiiooooouuuucn";

/** Parecença mínima (0 a 1) para um nome entrar na lista só por semelhança. */
const PARECENCA_MINIMA = 0.3;

type LinhaParecida = {
  id: string;
  nome: string;
  sku: string;
  ean: string | null;
  custoMedio: unknown;
  unidadeBase: string;
  conteudoPorUnidade: unknown;
  marca: string | null;
  codigos: { codigo: string }[];
  embalagens: { id: string; nome: string; ean: string | null; fator: number }[];
  parecenca: number;
};

/**
 * Produtos cujo nome PARECE o que foi digitado, mesmo sem bater letra a letra.
 *
 * Dois sinais: a semelhança da frase inteira com algum trecho do nome
 * (`word_similarity`, trigramas) e quantas palavras digitadas aparecem nele.
 * Basta um para o produto entrar — quem decide a ordem final é o ranqueamento
 * em JS, que recebe a semelhança como desempate.
 *
 * Já volta com códigos e embalagens: buscar os detalhes numa segunda ida ao
 * banco era mais uma volta inteira a cada tecla.
 */
async function candidatosParecidos(
  termo: string,
  tokens: string[],
): Promise<(ProdutoBuscado & { similaridade: number })[]> {
  const tenantId = requireTenantId();

  // SQL com parâmetros numerados, sem fragmentos `Prisma.sql` aninhados: no
  // bundle do Next o fragmento chegava ao client como VALOR (virava jsonb) e a
  // consulta quebrava — num script avulso funcionava, o que escondia o erro.
  // Tudo que vem de fora vai como parâmetro; só a estrutura é texto.
  const nome = `translate(lower(p."nome"), $2, $3)`;
  // Um parâmetro por palavra, a partir do $7. Tokens só têm [a-z0-9] (ver
  // `tokensDaBusca`): nada a escapar no LIKE.
  const acertos = tokens.map((_, i) => `(${nome} LIKE $${7 + i})::int`).join(" + ");
  const sql = `
    SELECT p."id", p."nome", p."sku", p."ean", p."custoMedio",
      p."unidadeBase"::text AS "unidadeBase", p."conteudoPorUnidade",
      b."nome" AS marca,
      COALESCE((
        SELECT json_agg(json_build_object('codigo', pb."codigo"))
        FROM "ProductBarcode" pb WHERE pb."productId" = p."id"
      ), '[]'::json) AS codigos,
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', pk."id", 'nome', pk."nome", 'ean', pk."ean", 'fator', pk."fatorConversao"
        ))
        FROM "ProductPackaging" pk WHERE pk."productId" = p."id"
      ), '[]'::json) AS embalagens,
      word_similarity($1, ${nome}) AS parecenca
    FROM "Product" p
    LEFT JOIN "Brand" b ON b."id" = p."brandId"
    WHERE p."tenantId" = $4
      AND p."ativo" = true
      AND (word_similarity($1, ${nome}) >= $5 OR (${acertos}) > 0)
    ORDER BY (${acertos}) DESC, parecenca DESC
    LIMIT $6
  `;

  const linhas = await comTenant(
    tenantId,
    basePrisma.$queryRawUnsafe<LinhaParecida[]>(
      sql,
      termo,
      COM_ACENTO,
      SEM_ACENTO,
      tenantId,
      PARECENCA_MINIMA,
      CANDIDATOS,
      ...tokens.map((t) => `%${t}%`),
    ),
  );

  return linhas.map((l) => ({
    id: l.id,
    nome: l.nome,
    sku: l.sku,
    ean: l.ean,
    imagemUrl: null,
    custoMedio: Number(l.custoMedio ?? 0),
    unidadeBase: l.unidadeBase,
    conteudoPorUnidade: l.conteudoPorUnidade == null ? null : Number(l.conteudoPorUnidade),
    marca: l.marca,
    codigos: l.codigos,
    embalagens: l.embalagens.map((e) => ({ ...e, fator: Number(e.fator) })),
    saldo: 0,
    ultimaCompra: null,
    similaridade: Number(l.parecenca),
  }));
}

/** Plano B: todas as palavras no nome, SKU ou marca — exato, sem parecença. */
async function porPalavras(tokens: string[]): Promise<(ProdutoBuscado & { similaridade: number })[]> {
  const produtos = await db.product.findMany({
    where: {
      ativo: true,
      AND: tokens.map((t) => ({
        OR: [
          { nome: { contains: t, mode: "insensitive" as const } },
          { sku: { contains: t, mode: "insensitive" as const } },
          { brand: { is: { nome: { contains: t, mode: "insensitive" as const } } } },
        ],
      })),
    },
    select: SELECAO,
    take: CANDIDATOS,
  });
  return produtos.map((p) => ({ ...paraBuscado(p), similaridade: 0 }));
}

/** O que a busca carrega de cada produto — a foto fica de fora de propósito. */
const SELECAO = {
  id: true,
  nome: true,
  sku: true,
  ean: true,
  custoMedio: true,
  unidadeBase: true,
  conteudoPorUnidade: true,
  brand: { select: { nome: true } },
  // Apelidos de código: sem eles o ranqueamento daria 0 ponto a um bipe
  // que casou exato, e o produto certo cairia fora do LIMIT.
  barcodes: { select: { codigo: true } },
  packagings: { select: { id: true, nome: true, ean: true, fatorConversao: true } },
} satisfies Prisma.ProductSelect;

type ProdutoSelecionado = Prisma.ProductGetPayload<{ select: typeof SELECAO }>;

function paraBuscado(p: ProdutoSelecionado): ProdutoBuscado {
  return {
    id: p.id,
    nome: p.nome,
    sku: p.sku,
    ean: p.ean,
    // Preenchido em `comContexto`, só para quem vai à tela.
    imagemUrl: null,
    custoMedio: Number(p.custoMedio ?? 0),
    unidadeBase: p.unidadeBase,
    conteudoPorUnidade: p.conteudoPorUnidade == null ? null : Number(p.conteudoPorUnidade),
    marca: p.brand?.nome ?? null,
    codigos: p.barcodes,
    embalagens: p.packagings.map((e) => ({
      id: e.id,
      nome: e.nome,
      ean: e.ean,
      fator: Number(e.fatorConversao),
    })),
    saldo: 0,
    ultimaCompra: null,
  };
}

export async function buscarProdutosParaRelacionar(
  termo: string,
  opts: {
    gtin?: string | null;
    limite?: number;
    /** Fornecedor da nota — faz "última compra" virar "última compra DELE". */
    supplierId?: string | null;
    /** Loja da entrada; sem ela o saldo é a soma de todas. */
    siteId?: string | null;
  } = {},
): Promise<ProdutoBuscado[]> {
  const q = termo.trim();
  const limite = opts.limite ?? 15;
  const tokens = tokensDaBusca(q);
  const digitos = onlyDigits(q);
  const gtin = opts.gtin ? onlyDigits(opts.gtin) : "";

  if (tokens.length === 0 && digitos.length < 4 && !gtin) return [];

  // Códigos: o digitado (principal, apelido ou DUN de embalagem) e o GTIN do
  // item da nota — o palpite mais forte que existe, mesmo com outro texto.
  // Piso de 4 e não de 8: código interno de balança é curto e precisa casar
  // igual. Abaixo disso o OR casaria metade do catálogo.
  const porCodigo: Prisma.ProductWhereInput[] = [
    ...(digitos.length >= 4 ? alternativasComEmbalagem(digitos) : []),
    ...(gtin ? alternativasComEmbalagem(gtin) : []),
  ];

  // As duas portas em paralelo: o que casa por código e o que parece pelo nome.
  const [diretos, parecidos] = await Promise.all([
    porCodigo.length > 0
      ? db.product.findMany({ where: { ativo: true, OR: porCodigo }, select: SELECAO, take: CANDIDATOS })
      : Promise.resolve([] as ProdutoSelecionado[]),
    tokens.length > 0
      ? candidatosParecidos(semAcento(q), tokens).catch((e: unknown) => {
          // A busca por parecença depende do pg_trgm e de SQL cru. Se falhar,
          // a tela não pode cair junto (as sugestões da nota passam por aqui
          // no carregamento): volta à busca palavra a palavra, exata.
          console.error("[busca-produto] parecença indisponível, usando busca exata", e);
          return porPalavras(tokens);
        })
      : Promise.resolve([]),
  ]);

  // Quem casou por código e também parece pelo nome fica com a parecença.
  const parecencaPorId = new Map(parecidos.map((p) => [p.id, p.similaridade]));
  const jaTem = new Set(diretos.map((p) => p.id));
  const mapeados = [
    ...diretos.map((p) => ({ ...paraBuscado(p), similaridade: parecencaPorId.get(p.id) })),
    ...parecidos.filter((p) => !jaTem.has(p.id)),
  ];

  // Contexto só do que vai à tela: ranquear primeiro e enriquecer os ~15 que
  // sobram evita varrer estoque e compras de sessenta produtos por tecla.
  const escolhidos = ordenarPorRelevancia(mapeados, q, gtin || null).slice(0, limite);
  return comContexto(escolhidos, opts.supplierId ?? null, opts.siteId ?? null);
}

/**
 * Produtos que ESTE fornecedor já mandou antes — o ponto de partida da busca
 * quando a descrição do XML não casa com nada. O de-para de notas anteriores
 * (`SupplierItemMap`) é a melhor lista de "coisas que este caminhão traz".
 */
export async function produtosJaFornecidos(
  supplierId: string,
  opts: { limite?: number; siteId?: string | null } = {},
): Promise<ProdutoBuscado[]> {
  const limite = opts.limite ?? 12;
  const mapas = await db.supplierItemMap.findMany({
    where: { supplierId },
    orderBy: { updatedAt: "desc" },
    take: limite * 2,
    select: { productId: true },
  });
  const ids = [...new Set(mapas.map((m) => m.productId))].slice(0, limite);
  if (ids.length === 0) return [];
  return produtosPorId(ids, { supplierId, siteId: opts.siteId ?? null });
}

/** Quem já é dono deste código de barras — o produto ou uma embalagem dele. */
export async function donoDoCodigo(
  gtin: string,
): Promise<{ productId: string; nome: string; sku: string; onde: string } | null> {
  const codigo = onlyDigits(gtin);
  // Sem piso de comprimento: código interno da loja tem dono igual, e deixar
  // de avisar só adia a descoberta para a hora de bipar.
  if (!codigo) return null;

  const [produto, embalagem] = await Promise.all([
    db.product.findFirst({
      where: { ativo: true, OR: alternativasPorCodigo(codigo) },
      select: { id: true, nome: true, sku: true },
    }),
    db.productPackaging.findFirst({
      where: { ean: codigo },
      select: { nome: true, product: { select: { id: true, nome: true, sku: true, ativo: true } } },
    }),
  ]);

  if (produto) {
    return { productId: produto.id, nome: produto.nome, sku: produto.sku, onde: "o produto" };
  }
  if (embalagem?.product.ativo) {
    return {
      productId: embalagem.product.id,
      nome: embalagem.product.nome,
      sku: embalagem.product.sku,
      onde: `a embalagem "${embalagem.nome}"`,
    };
  }
  return null;
}

/** Os mesmos produtos da busca, mas por id — sem ranqueamento. */
async function produtosPorId(
  ids: string[],
  opts: { supplierId?: string | null; siteId?: string | null },
): Promise<ProdutoBuscado[]> {
  const produtos = await db.product.findMany({
    where: { id: { in: ids }, ativo: true },
    select: SELECAO,
  });

  // A ordem de `ids` é a ordem de relevância de quem chamou (mais recente
  // primeiro, no caso do fornecedor) — o `findMany` não a preserva.
  const porId = new Map(produtos.map((p) => [p.id, p]));
  const naOrdem = ids.map((id) => porId.get(id)).filter((p) => p != null);

  return comContexto(naOrdem.map(paraBuscado), opts.supplierId ?? null, opts.siteId ?? null);
}

/**
 * Preenche saldo, última compra e o endereço da foto. Três consultas para a
 * lista inteira, em paralelo — uma por produto seria N round-trips ao Neon a
 * cada tecla digitada.
 *
 * A foto sai como caminho, nunca como conteúdo: `data:` guardado na coluna
 * vira `/api/produtos/<id>/imagem`, que o navegador baixa depois da lista.
 */
async function comContexto(
  produtos: ProdutoBuscado[],
  supplierId: string | null,
  siteId: string | null,
): Promise<ProdutoBuscado[]> {
  if (produtos.length === 0) return produtos;
  const ids = produtos.map((p) => p.id);

  const tenantId = requireTenantId();
  const [saldos, entradas, fotos] = await Promise.all([
    db.stock.findMany({
      where: { productId: { in: ids }, ...(siteId ? { siteId } : {}) },
      select: { productId: true, estoqueFechado: true },
    }),
    // Entrada estornada não é histórico de preço: é um lançamento desfeito.
    db.purchaseItem.findMany({
      where: { productId: { in: ids }, purchase: { estornadaEm: null } },
      orderBy: { purchase: { data: "desc" } },
      // O suficiente para achar a última de cada produto sem uma query por id.
      take: ids.length * 6,
      select: {
        productId: true,
        quantidade: true,
        custoTotal: true,
        purchase: { select: { data: true, supplierId: true } },
      },
    }),
    // Só o começo da coluna: o suficiente para saber se é `data:` sem trazer
    // os KB da imagem junto.
    comTenant(
      tenantId,
      basePrisma.$queryRaw<{ id: string; atualizado: Date; foto: string | null }[]>`
        SELECT "id", "updatedAt" AS atualizado,
          CASE WHEN left("imagemUrl", 5) = 'data:' THEN 'data:' ELSE "imagemUrl" END AS foto
        FROM "Product"
        WHERE "tenantId" = ${tenantId} AND "id" = ANY(${ids})
      `,
    ),
  ]);

  const fotoPorProduto = new Map(
    fotos.map((f) => [f.id, urlImagemProduto(f.id, f.foto, new Date(f.atualizado))]),
  );

  const saldoPorProduto = new Map<string, number>();
  for (const s of saldos) {
    saldoPorProduto.set(
      s.productId,
      (saldoPorProduto.get(s.productId) ?? 0) + Number(s.estoqueFechado),
    );
  }

  // A do MESMO fornecedor ganha: comparar o preço de hoje com o do concorrente
  // não diz nada sobre o aumento que este caminhão está trazendo.
  const compraPorProduto = new Map<string, ProdutoBuscado["ultimaCompra"]>();
  for (const e of entradas) {
    const qtd = Number(e.quantidade);
    if (qtd <= 0) continue;
    const doMesmo = Boolean(supplierId) && e.purchase.supplierId === supplierId;
    const atual = compraPorProduto.get(e.productId);
    // `entradas` já vem da mais recente para a mais antiga: a primeira de cada
    // produto fica, e só é trocada por uma do fornecedor certo.
    if (atual && (atual.doMesmoFornecedor || !doMesmo)) continue;
    compraPorProduto.set(e.productId, {
      data: e.purchase.data.toISOString(),
      custoUnitario: Number(e.custoTotal) / qtd,
      doMesmoFornecedor: doMesmo,
    });
  }

  return produtos.map((p) => ({
    ...p,
    imagemUrl: fotoPorProduto.get(p.id) ?? null,
    saldo: saldoPorProduto.get(p.id) ?? 0,
    ultimaCompra: compraPorProduto.get(p.id) ?? null,
  }));
}
