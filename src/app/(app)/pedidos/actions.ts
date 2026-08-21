"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction } from "@/lib/guard";
import type { Permissao } from "@/lib/permissoes";
import { runWithTenant } from "@/lib/tenant-context";
import { criarPedidoCompra } from "@/lib/estoque";
import { db } from "@/lib/prisma";
import { listarEventos } from "@/lib/compras/eventos";
import { loadHistoricoCompraProduto } from "../cotacoes/_data";

/** Baseline de leitura do módulo. Escrita usa `txp` com a loja de destino. */
async function tx<T>(fn: (tid: string, userId: string) => Promise<T>): Promise<T> {
  const ctx = await guardAction("compras.ver");
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id, ctx.user.id ?? ""));
}

async function txp<T>(
  permissao: Permissao,
  siteId: string | null,
  fn: (tid: string, userId: string) => Promise<T>,
): Promise<T> {
  const ctx = await guardAction(permissao, siteId);
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id, ctx.user.id ?? ""));
}

const ok = () => {
  revalidatePath("/cotacoes", "layout");
  revalidatePath("/pedidos", "layout");
  revalidatePath("/pedidos", "layout");
  revalidatePath("/estoque", "layout");
};

// ── Pedidos de reposição em lote ──────────────────────────────
// Recebe a revisão das sugestões (já agrupadas por fornecedor no client)
// e cria um pedido de compra por fornecedor, tudo de uma vez.

const reposicaoPedidoSchema = z.object({
  supplierId: z.string().min(1),
  previsaoEntrega: z.string().optional().nullable(), // yyyy-mm-dd
  observacao: z.string().optional().nullable(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        packagingId: z.string().optional().nullable(),
        qtdPedida: z.number().positive(),
        custoUnitario: z.number().nonnegative().default(0),
        observacao: z.string().trim().max(500).optional().nullable(),
      }),
    )
    .min(1),
});

const reposicaoSchema = z.object({
  siteId: z.string().min(1, "Selecione a loja de destino."),
  enviar: z.boolean().default(true),
  pedidos: z.array(reposicaoPedidoSchema).min(1, "Nenhum item selecionado."),
});

export async function criarPedidosReposicaoAction(input: z.input<typeof reposicaoSchema>) {
  const d = reposicaoSchema.parse(input);
  return txp("compras.pedir", d.siteId, async (tid, userId) => {
    const ids: string[] = [];
    // Sequencial de propósito: o número do pedido (PC-000NN) é gerado por
    // tenant e criações paralelas colidiriam no unique.
    for (const pedido of d.pedidos) {
      const id = await criarPedidoCompra(
        tid,
        {
          siteId: d.siteId,
          supplierId: pedido.supplierId,
          previsaoEntrega: pedido.previsaoEntrega ? new Date(`${pedido.previsaoEntrega}T00:00:00`) : null,
          observacao: pedido.observacao ?? null,
          items: pedido.items,
        },
        { enviar: d.enviar, createdBy: userId },
      );
      ids.push(id);
    }
    // Número gerado (PC-000NN) volta ao client — entra na mensagem ao fornecedor.
    const criados = await db.purchaseOrder.findMany({
      where: { id: { in: ids } },
      select: { id: true, numero: true, supplierId: true },
    });
    ok();
    return criados;
  });
}

// ── Histórico de compras do produto (lazy, p/ drawer) ─────────

export async function fetchHistoricoCompraProdutoAction(productId: string) {
  return tx(() => loadHistoricoCompraProduto(productId));
}

// ── Linha do tempo do pedido (lazy, p/ drawer) ────────────────

export async function listarEventosPedidoAction(purchaseOrderId: string) {
  return tx((tid) => listarEventos(tid, purchaseOrderId));
}

// ── Códigos de barras do pedido (p/ bipe no recebimento sem XML) ──
// Um produto/embalagem por vez seria N idas ao banco; aqui é uma só,
// batendo productId+packagingId de cada linha contra o catálogo.

export async function buscarCodigosDeBarrasAction(
  itens: { itemId: string; productId: string; packagingId: string | null }[],
) {
  return tx(async () => {
    const productIds = [...new Set(itens.map((i) => i.productId))];
    if (productIds.length === 0) return {};

    const produtos = await db.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, ean: true, packagings: { select: { id: true, ean: true } } },
    });
    const porProduto = new Map(produtos.map((p) => [p.id, p]));

    const mapa: Record<string, string[]> = {};
    for (const it of itens) {
      const p = porProduto.get(it.productId);
      if (!p) continue;
      const codigos: string[] = [];
      if (p.ean) codigos.push(p.ean);
      const pkg = it.packagingId ? p.packagings.find((pk) => pk.id === it.packagingId) : null;
      if (pkg?.ean) codigos.push(pkg.ean);
      if (codigos.length > 0) mapa[it.itemId] = codigos;
    }
    return mapa;
  });
}
