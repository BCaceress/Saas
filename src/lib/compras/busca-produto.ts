import "server-only";
import { db } from "@/lib/prisma";
import { onlyDigits } from "@/lib/normalize";
import { ordenarPorRelevancia, tokensDaBusca } from "./busca-produto-rank";
import type { Prisma } from "@/generated/prisma";

// ============================================================
// Busca de produto para relacionar um item de nota ao catálogo.
//
// Duas correções sobre o `contains` ingênuo:
//
//  1. procura PALAVRA A PALAVRA. "CERV HEINEKEN LN" não existe como frase em
//     "Cerveja Heineken Long Neck 330ml" — mas as três palavras existem. Com
//     `contains` da frase inteira, a busca que a tela abre não achava nada.
//  2. traz mais linhas do que mostra e ORDENA POR RELEVÂNCIA. Ordenar por nome
//     no banco com LIMIT chega a cortar fora justamente o produto certo.
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
  embalagens: { id: string; nome: string; ean: string | null; fator: number }[];
  /** Eixo da variação comercial ("Sabor"). Null = produto sem variação. */
  variacaoLabel: string | null;
  /** Sabores compráveis — a linha da nota escolhe um; o saldo é um só. */
  variacoes: { id: string; nome: string; ean: string | null }[];
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

  const alternativas: Prisma.ProductWhereInput[] = [];

  // Todas as palavras digitadas, cada uma no nome ou no SKU.
  if (tokens.length > 0) {
    alternativas.push({
      AND: tokens.map((t) => ({
        OR: [
          { nome: { contains: t, mode: "insensitive" as const } },
          { sku: { contains: t, mode: "insensitive" as const } },
        ],
      })),
    });
  }

  // Código de barras digitado — do produto ou de uma embalagem dele.
  if (digitos.length >= 8) {
    alternativas.push({ ean: digitos });
    alternativas.push({ packagings: { some: { ean: digitos } } });
    alternativas.push({ purchaseVariants: { some: { ean: digitos, ativo: true } } });
  }

  // O GTIN do item da nota entra como candidato mesmo quando o operador está
  // digitando outra coisa: é o palpite mais forte que existe, e some da lista
  // se o texto digitado não tiver nada a ver.
  if (gtin) {
    alternativas.push({ ean: gtin });
    alternativas.push({ packagings: { some: { ean: gtin } } });
    alternativas.push({ purchaseVariants: { some: { ean: gtin, ativo: true } } });
  }

  const produtos = await db.product.findMany({
    where: { ativo: true, OR: alternativas },
    select: {
      id: true,
      nome: true,
      sku: true,
      ean: true,
      imagemUrl: true,
      custoMedio: true,
      unidadeBase: true,
      conteudoPorUnidade: true,
      packagings: { select: { id: true, nome: true, ean: true, fatorConversao: true } },
      variacaoLabel: true,
      purchaseVariants: {
        where: { ativo: true },
        orderBy: [{ ordem: "asc" }, { nome: "asc" }],
        select: { id: true, nome: true, ean: true },
      },
    },
    take: CANDIDATOS,
  });

  const mapeados: ProdutoBuscado[] = produtos.map((p) => ({
    id: p.id,
    nome: p.nome,
    sku: p.sku,
    ean: p.ean,
    imagemUrl: p.imagemUrl,
    custoMedio: Number(p.custoMedio ?? 0),
    unidadeBase: p.unidadeBase,
    conteudoPorUnidade: p.conteudoPorUnidade == null ? null : Number(p.conteudoPorUnidade),
    embalagens: p.packagings.map((e) => ({
      id: e.id,
      nome: e.nome,
      ean: e.ean,
      fator: Number(e.fatorConversao),
    })),
    variacaoLabel: p.variacaoLabel,
    variacoes: p.purchaseVariants,
    saldo: 0,
    ultimaCompra: null,
  }));

  // Contexto só do que vai à tela: ranquear primeiro e enriquecer os ~20 que
  // sobram evita duas varreduras de estoque e de compras por tecla digitada.
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

/** Quem já é dono deste código de barras — produto, embalagem ou variação. */
export async function donoDoCodigo(
  gtin: string,
): Promise<{ productId: string; nome: string; sku: string; onde: string } | null> {
  const codigo = onlyDigits(gtin);
  if (codigo.length < 8) return null;

  const [produto, embalagem, variacao] = await Promise.all([
    db.product.findFirst({
      where: { ean: codigo, ativo: true },
      select: { id: true, nome: true, sku: true },
    }),
    db.productPackaging.findFirst({
      where: { ean: codigo },
      select: { nome: true, product: { select: { id: true, nome: true, sku: true, ativo: true } } },
    }),
    db.productPurchaseVariant.findFirst({
      where: { ean: codigo, ativo: true },
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
  if (variacao?.product.ativo) {
    return {
      productId: variacao.product.id,
      nome: variacao.product.nome,
      sku: variacao.product.sku,
      onde: `a variação "${variacao.nome}"`,
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
    select: {
      id: true,
      nome: true,
      sku: true,
      ean: true,
      imagemUrl: true,
      custoMedio: true,
      unidadeBase: true,
      conteudoPorUnidade: true,
      packagings: { select: { id: true, nome: true, ean: true, fatorConversao: true } },
      variacaoLabel: true,
      purchaseVariants: {
        where: { ativo: true },
        orderBy: [{ ordem: "asc" }, { nome: "asc" }],
        select: { id: true, nome: true, ean: true },
      },
    },
  });

  // A ordem de `ids` é a ordem de relevância de quem chamou (mais recente
  // primeiro, no caso do fornecedor) — o `findMany` não a preserva.
  const porId = new Map(produtos.map((p) => [p.id, p]));
  const naOrdem = ids.map((id) => porId.get(id)).filter((p) => p != null);

  return comContexto(
    naOrdem.map((p) => ({
      id: p.id,
      nome: p.nome,
      sku: p.sku,
      ean: p.ean,
      imagemUrl: p.imagemUrl,
      custoMedio: Number(p.custoMedio ?? 0),
      unidadeBase: p.unidadeBase,
      conteudoPorUnidade: p.conteudoPorUnidade == null ? null : Number(p.conteudoPorUnidade),
      embalagens: p.packagings.map((e) => ({
        id: e.id,
        nome: e.nome,
        ean: e.ean,
        fator: Number(e.fatorConversao),
      })),
      variacaoLabel: p.variacaoLabel,
      variacoes: p.purchaseVariants,
      saldo: 0,
      ultimaCompra: null,
    })),
    opts.supplierId ?? null,
    opts.siteId ?? null,
  );
}

/**
 * Preenche saldo e última compra. Duas consultas para a lista inteira — uma
 * por produto seria N round-trips ao Neon a cada tecla digitada.
 */
async function comContexto(
  produtos: ProdutoBuscado[],
  supplierId: string | null,
  siteId: string | null,
): Promise<ProdutoBuscado[]> {
  if (produtos.length === 0) return produtos;
  const ids = produtos.map((p) => p.id);

  const [saldos, entradas] = await Promise.all([
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
  ]);

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
    saldo: saldoPorProduto.get(p.id) ?? 0,
    ultimaCompra: compraPorProduto.get(p.id) ?? null,
  }));
}
