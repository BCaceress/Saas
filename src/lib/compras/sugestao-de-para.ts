import "server-only";
import { db } from "@/lib/prisma";
import { buscarProdutosParaRelacionar } from "./busca-produto";
import { termoDeBuscaDoItem } from "./conciliacao-regras";
import { casaPorCodigo, inferirVinculo } from "@/lib/fiscal/vinculo";
import { casarComPedido, mesclarSugestoes } from "./sugestao-pelo-pedido-regras";

// ============================================================
// Melhor palpite de produto para cada linha da nota ainda sem de-para.
//
// Vive no domínio (e não numa server action) porque a tela precisa dele DUAS
// vezes com origens diferentes: carregado junto com a nota, no servidor, para
// a tabela já nascer com os palpites; e recalculado depois de cada de-para,
// porque relacionar uma linha pode criar embalagem/EAN que muda o palpite das
// outras.
// ============================================================

export type SugestaoDePara = {
  itemId: string;
  productId: string;
  nome: string;
  sku: string;
  imagemUrl: string | null;
  unidade: string;
  /**
   * EAN é prova; NOME é palpite — e o operador confia diferente em cada um.
   * PEDIDO é o palpite por nome feito só entre os produtos do pedido que a
   * nota fatura: universo de vinte, não de mil.
   */
  motivo: "EAN" | "NOME" | "PEDIDO";
  packagingId: string | null;
  fatorConversao: number;
};

/**
 * Os palpites da nota. Com o pedido informado, os produtos dele entram na
 * disputa — e a camada mais forte de cada item vence (ver `mesclarSugestoes`).
 */
export async function sugestoesDaNota(
  inboundId: string,
  opts: { purchaseOrderId?: string | null } = {},
): Promise<SugestaoDePara[]> {
  const doCatalogo = await sugestoesDoCatalogo(inboundId);
  if (!opts.purchaseOrderId) return doCatalogo;
  return mesclarSugestoes(await sugestoesPeloPedido(inboundId, opts.purchaseOrderId), doCatalogo);
}

async function sugestoesDoCatalogo(inboundId: string): Promise<SugestaoDePara[]> {
  const nota = await db.fiscalInbound.findFirst({
    where: { id: inboundId },
    select: {
      items: {
        where: { productId: null },
        select: {
          id: true,
          descricao: true,
          gtin: true,
          unidade: true,
          quantidade: true,
          unidadeTributavel: true,
          quantidadeTributavel: true,
        },
      },
    },
  });
  if (!nota) return [];

  const sugestoes = await Promise.all(
    nota.items.map(async (i) => {
      const item = {
        gtin: i.gtin,
        // uCom viaja junto: é ela que responde "0,6 MI são 600 unidades"
        // quando a nota não declara qTrib.
        unidade: i.unidade,
        quantidade: Number(i.quantidade),
        unidadeTributavel: i.unidadeTributavel,
        quantidadeTributavel:
          i.quantidadeTributavel == null ? null : Number(i.quantidadeTributavel),
      };
      const achados = await buscarProdutosParaRelacionar(termoDeBuscaDoItem(i.descricao), {
        gtin: i.gtin,
        limite: 2,
      });
      const p = achados[0];
      if (!p) return null;

      const produto = {
        ean: p.ean,
        codigos: p.codigos,
        packagings: p.embalagens.map((e) => ({
          id: e.id,
          ean: e.ean,
          fatorConversao: e.fator,
        })),
      };
      // Código de barras batendo é prova; nome parecido é palpite. A tela
      // trata os dois de forma diferente, então a diferença viaja junto.
      const porCodigo = casaPorCodigo(produto, i.gtin);
      // Palpite fraco com concorrente à vista não é sugestão, é chute: o
      // operador decide mais rápido na busca do que desfazendo um erro.
      if (!porCodigo && achados.length > 1) return null;

      return {
        itemId: i.id,
        productId: p.id,
        nome: p.nome,
        sku: p.sku,
        imagemUrl: p.imagemUrl,
        unidade: p.unidadeBase,
        motivo: porCodigo ? ("EAN" as const) : ("NOME" as const),
        ...inferirVinculo(produto, item),
      };
    }),
  );

  return sugestoes.flatMap((s) => (s ? [s] : []));
}

/**
 * Palpites para os itens sem de-para, olhando só para o pedido escolhido.
 *
 * É o que faz a pergunta do pedido vir ANTES da dos produtos: respondido de
 * qual pedido é a nota, boa parte do de-para deixa de ser busca no catálogo e
 * vira "é este do pedido?".
 */
async function sugestoesPeloPedido(
  inboundId: string,
  purchaseOrderId: string,
): Promise<SugestaoDePara[]> {
  const [nota, pedido] = await Promise.all([
    db.fiscalInbound.findFirst({
      where: { id: inboundId },
      select: {
        items: {
          select: {
            id: true,
            descricao: true,
            gtin: true,
            unidade: true,
            quantidade: true,
            unidadeTributavel: true,
            quantidadeTributavel: true,
            productId: true,
          },
        },
      },
    }),
    db.purchaseOrder.findFirst({
      where: { id: purchaseOrderId },
      select: { items: { select: { productId: true } } },
    }),
  ]);
  if (!nota || !pedido) return [];

  const pendentes = nota.items.filter((i) => !i.productId);
  const ids = [...new Set(pedido.items.map((i) => i.productId))];
  if (pendentes.length === 0 || ids.length === 0) return [];

  const produtos = await db.product.findMany({
    where: { id: { in: ids }, ativo: true },
    select: {
      id: true,
      nome: true,
      sku: true,
      ean: true,
      imagemUrl: true,
      unidadeBase: true,
      barcodes: { select: { codigo: true } },
      packagings: { select: { id: true, ean: true, fatorConversao: true } },
    },
  });
  const porId = new Map(produtos.map((p) => [p.id, p]));

  const pares = casarComPedido(
    pendentes.map((i) => ({ id: i.id, descricao: i.descricao, gtin: i.gtin })),
    produtos.map((p) => ({
      id: p.id,
      nome: p.nome,
      codigos: [p.ean, ...p.barcodes.map((b) => b.codigo), ...p.packagings.map((e) => e.ean)].filter(
        (c): c is string => Boolean(c),
      ),
    })),
    // Produto do pedido que outra linha da nota já ocupou não responde de novo.
    nota.items.map((i) => i.productId).filter((id): id is string => Boolean(id)),
  );

  return pares.flatMap((par) => {
    const p = porId.get(par.productId);
    const i = pendentes.find((x) => x.id === par.itemId);
    if (!p || !i) return [];
    return [
      {
        itemId: i.id,
        productId: p.id,
        nome: p.nome,
        sku: p.sku,
        imagemUrl: p.imagemUrl,
        unidade: p.unidadeBase,
        motivo: par.motivo === "EAN" ? ("EAN" as const) : ("PEDIDO" as const),
        ...inferirVinculo(
          {
            ean: p.ean,
            codigos: p.barcodes,
            packagings: p.packagings.map((e) => ({
              id: e.id,
              ean: e.ean,
              fatorConversao: Number(e.fatorConversao),
            })),
          },
          {
            gtin: i.gtin,
            unidade: i.unidade,
            quantidade: Number(i.quantidade),
            unidadeTributavel: i.unidadeTributavel,
            quantidadeTributavel:
              i.quantidadeTributavel == null ? null : Number(i.quantidadeTributavel),
          },
        ),
      },
    ];
  });
}
