"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { criarPedidoCompra } from "@/lib/estoque";
import { db } from "@/lib/prisma";
import { loadHistoricoCompraProduto } from "./_data";

async function tx<T>(fn: (tid: string, userId: string) => Promise<T>): Promise<T> {
  const ctx = await requireActiveTenant();
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id, ctx.user.id ?? ""));
}

const ok = () => {
  revalidatePath("/compras", "layout");
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
  return tx(async (tid, userId) => {
    const d = reposicaoSchema.parse(input);
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
