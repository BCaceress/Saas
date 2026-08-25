import "server-only";
import { basePrisma, comTenant } from "@/lib/prisma";

// ============================================================
// Variação comercial de compra
//
// O operador compra Bubbaloo Morango, Uva e Tutti-Frutti. Na prateleira existe
// um produto só — "Bubbaloo Sortido" — e é nele que os 150 UN entram. O sabor
// não vira SKU, não vira saldo e não aparece no caixa: ele é atributo da
// ORIGEM da compra, e vive no item do pedido e no item da entrada.
//
// Este módulo é a fonte única de três perguntas:
//   1. quais variações este produto tem? (seletores de compra)
//   2. esta variação é mesmo deste produto? (gravação — nunca confiar no client)
//   3. de que produto + variação é este código de barras? (XML e scanner)
//
// Tudo aqui é `basePrisma` + `comTenant` com o tenantId na mão, como no resto
// do motor de estoque: estas funções rodam dentro de transações e de jobs, onde
// o AsyncLocalStorage nem sempre está montado.
// ============================================================

export type VariacaoOpcao = {
  id: string;
  nome: string;
  ean: string | null;
  codigoFornecedor: string | null;
};

/**
 * Variações ativas dos produtos pedidos, prontas para o seletor da tela de
 * compra. Uma consulta só para a lista inteira — as telas de entrada carregam
 * centenas de produtos e não podem consultar uma vez por linha.
 */
export async function variacoesDosProdutos(
  tenantId: string,
  productIds: string[],
): Promise<Map<string, VariacaoOpcao[]>> {
  const ids = [...new Set(productIds.filter(Boolean))];
  const mapa = new Map<string, VariacaoOpcao[]>();
  if (ids.length === 0) return mapa;

  const linhas = await comTenant(
    tenantId,
    basePrisma.productPurchaseVariant.findMany({
      where: { tenantId, productId: { in: ids }, ativo: true },
      orderBy: [{ ordem: "asc" }, { nome: "asc" }],
      select: { id: true, productId: true, nome: true, ean: true, codigoFornecedor: true },
    }),
  );

  for (const v of linhas) {
    const lista = mapa.get(v.productId) ?? [];
    lista.push({ id: v.id, nome: v.nome, ean: v.ean, codigoFornecedor: v.codigoFornecedor });
    mapa.set(v.productId, lista);
  }
  return mapa;
}

/** Variações ativas de um produto só (ficha do produto, seletor de uma linha). */
export async function variacoesDoProduto(
  tenantId: string,
  productId: string,
): Promise<VariacaoOpcao[]> {
  return (await variacoesDosProdutos(tenantId, [productId])).get(productId) ?? [];
}

export type VariacaoResolvida = { variantId: string; variacaoNome: string };

/**
 * Confere que cada variação informada pertence ao produto daquela linha e
 * devolve o nome a congelar no documento. Sem a checagem, um payload trocado
 * gravaria "Morango" na compra de outro produto — e ninguém veria, porque o
 * estoque não olha para o sabor.
 *
 * A chave do mapa é o variantId; linhas sem variação simplesmente não entram.
 */
export async function resolverVariacoesDosItens<
  T extends { productId: string; variantId?: string | null },
>(tenantId: string, itens: T[]): Promise<Map<string, VariacaoResolvida>> {
  const ids = [...new Set(itens.map((i) => i.variantId).filter((v): v is string => !!v))];
  const mapa = new Map<string, VariacaoResolvida>();
  if (ids.length === 0) return mapa;

  const linhas = await comTenant(
    tenantId,
    basePrisma.productPurchaseVariant.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, productId: true, nome: true },
    }),
  );

  const pares = new Set(itens.map((i) => `${i.productId}::${i.variantId ?? ""}`));
  for (const v of linhas) {
    if (pares.has(`${v.productId}::${v.id}`)) {
      mapa.set(v.id, { variantId: v.id, variacaoNome: v.nome });
    }
  }
  return mapa;
}

/**
 * De quem é este código de barras? Responde produto + variação quando o EAN é
 * de um sabor. É o que faz a NF-e com "BUBBALOO MORANGO" cair no Bubbaloo
 * Sortido já com o sabor preenchido, em vez de ficar pendente de vínculo.
 */
export async function resolverVariacaoPorEan(
  tenantId: string,
  ean: string,
): Promise<{ productId: string; variantId: string; variacaoNome: string } | null> {
  const digitos = ean.replace(/\D/g, "");
  if (!digitos) return null;

  const v = await comTenant(
    tenantId,
    basePrisma.productPurchaseVariant.findFirst({
      where: { tenantId, ean: digitos, ativo: true, product: { ativo: true } },
      select: { id: true, productId: true, nome: true },
    }),
  );
  if (!v) return null;
  return { productId: v.productId, variantId: v.id, variacaoNome: v.nome };
}

/** "Bubbaloo Sortido · Morango" — como o item de compra aparece nas listas. */
export function rotuloComVariacao(nome: string, variacaoNome?: string | null): string {
  return variacaoNome ? `${nome} · ${variacaoNome}` : nome;
}
