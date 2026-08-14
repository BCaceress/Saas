"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/prisma";
import { guardAction } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import {
  consultarProdutos,
  idsDoFiltro,
  linhasDoFiltro,
  linhasLevesPorIds,
  linhasPorIds,
} from "./_query";
import { loadProductFormOptions } from "./_data";
import type {
  LoteOpcoes,
  ProductRow,
  ProdutoConsulta,
  ProdutoFiltro,
  ProdutoGiro,
  ProdutoSortDir,
  ProdutoSortField,
  ProdutosPagina,
} from "./_types";

/**
 * Ações de LEITURA da listagem. Ficam separadas de `actions.ts` porque o guard
 * é outro: ler continua valendo com a assinatura suspensa (`mesmoSuspenso`), o
 * que trava é escrever.
 */
async function leitura<T>(fn: () => Promise<T>): Promise<T> {
  const ctx = await guardAction("produto.ver", null, { mesmoSuspenso: true });
  return runWithTenant(ctx.tenant.id, fn);
}

/** Uma página da listagem: linhas, giro e totais. */
export async function buscarProdutos(consulta: ProdutoConsulta): Promise<ProdutosPagina> {
  return leitura(() => consultarProdutos(consulta));
}

/** Ids de tudo que bate com o filtro — "selecionar todos os N". */
export async function selecionarIdsDoFiltro(filtro: ProdutoFiltro): Promise<string[]> {
  return leitura(() => idsDoFiltro(filtro));
}

/** Linhas do filtro inteiro, na ordem da tela — a planilha é montada no cliente. */
export async function linhasParaExport(
  filtro: ProdutoFiltro,
  sort: ProdutoSortField,
  dir: ProdutoSortDir,
): Promise<{ rows: ProductRow[]; giro: Record<string, ProdutoGiro> }> {
  return leitura(() => linhasDoFiltro(filtro, sort, dir));
}

/**
 * Linhas de ids avulsos. A seleção atravessa páginas — quem imprime etiqueta ou
 * busca imagem precisa da linha inteira, e ela pode não estar mais na tela.
 */
export async function linhasSelecionadas(ids: string[]): Promise<ProductRow[]> {
  return leitura(() => linhasPorIds(ids));
}

/** Fila da edição em lote: nome, SKU e tipo dos ids que não estão mais na tela. */
export async function produtosDoLote(
  ids: string[],
): Promise<{ id: string; nome: string; sku: string; tipo: string }[]> {
  return leitura(() => linhasLevesPorIds(ids));
}

/**
 * Opções do painel de edição em lote. Sai do MESMO cache das opções do
 * formulário de produto (`loadProductFormOptions`, por tenant, derrubado a cada
 * cadastro): quem já abriu "novo produto" nesta sessão do servidor não paga
 * consulta nenhuma para abrir o lote.
 *
 * Não reaproveita `getGerenciarExtras` porque aquele payload carrega o
 * fornecedor inteiro (endereço, IE, logo) para desenhar dois selects.
 */
export async function opcoesDoLote(): Promise<LoteOpcoes> {
  const ctx = await guardAction("produto.ver", null, { mesmoSuspenso: true });
  const o = await loadProductFormOptions(ctx.tenant.id);
  return { suppliers: o.supplierRows, fiscais: o.fiscalOpts, locais: o.storageOpts };
}

/**
 * Preço de venda direto da tabela (edição inline). Permissão própria
 * (`produto.preco`): quem repõe prateleira nem sempre remarca preço.
 */
export async function setPrecoVenda(id: string, preco: number | null): Promise<void> {
  const ctx = await guardAction("produto.preco");
  await runWithTenant(ctx.tenant.id, async () => {
    if (preco != null && (!Number.isFinite(preco) || preco < 0)) {
      throw new Error("Preço inválido.");
    }
    const alvo = await db.product.findFirst({ where: { id }, select: { id: true, tipo: true } });
    if (!alvo) throw new Error("Produto não encontrado.");
    if (alvo.tipo === "INSUMO") throw new Error("Insumo é de uso interno — não tem preço de venda.");
    await db.product.update({ where: { id }, data: { precoVenda: preco } });
  });
  revalidatePath("/produtos");
}
