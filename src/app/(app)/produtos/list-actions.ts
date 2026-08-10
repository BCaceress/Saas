"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/prisma";
import { guardAction } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import {
  consultarProdutos,
  idsDoFiltro,
  linhasDoFiltro,
  linhasPorIds,
  listarVisoes,
} from "./_query";
import type {
  ProductRow,
  ProdutoConsulta,
  ProdutoFiltro,
  ProdutoGiro,
  ProdutoSortDir,
  ProdutoSortField,
  ProdutosPagina,
  ProdutoVisao,
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

// ── Visões salvas ────────────────────────────────────────────────────────────

/** Visões do usuário + as da loja. */
export async function buscarVisoes(): Promise<ProdutoVisao[]> {
  const ctx = await guardAction("produto.ver", null, { mesmoSuspenso: true });
  return runWithTenant(ctx.tenant.id, () => listarVisoes(ctx.user.id));
}

/**
 * Salva (ou regrava) uma visão. `daLoja` a deixa sem dono — visível a todo
 * mundo do tenant; é como o gerente publica a lista que a equipe deve olhar.
 */
export async function salvarVisao(input: {
  nome: string;
  params: string;
  daLoja?: boolean;
}): Promise<ProdutoVisao[]> {
  const ctx = await guardAction("produto.ver");
  const nome = input.nome.trim();
  if (nome.length < 2) throw new Error("Dê um nome à visão.");
  if (nome.length > 60) throw new Error("Nome muito longo (máximo 60 caracteres).");

  return runWithTenant(ctx.tenant.id, async () => {
    const userId = input.daLoja ? null : ctx.user.id;
    const existente = await db.productView.findFirst({
      where: { nome, userId },
      select: { id: true },
    });
    if (existente) {
      await db.productView.update({ where: { id: existente.id }, data: { params: input.params } });
    } else {
      await db.productView.create({
        data: { tenantId: ctx.tenant.id, userId, nome, params: input.params },
      });
    }
    return listarVisoes(ctx.user.id);
  });
}

export async function apagarVisao(id: string): Promise<ProdutoVisao[]> {
  const ctx = await guardAction("produto.ver");
  return runWithTenant(ctx.tenant.id, async () => {
    await db.productView.deleteMany({ where: { id } });
    return listarVisoes(ctx.user.id);
  });
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
