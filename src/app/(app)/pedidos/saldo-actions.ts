"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction, assertSite } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import {
  saldoDoPedido,
  resolverSaldoPedido,
  type SaldoPedido,
  type ResultadoSaldo,
} from "@/lib/compras/saldo-pedido";

// ============================================================
// O saldo do pedido parcial precisa de um dono.
//
// A tela de pedidos mostrava "recebimento pendente" e não oferecia saída. Aqui
// o operador escolhe: o resto vem, o resto não vem, ou o resto vira um pedido
// novo. Escolher é obrigatório para o pedido sair da fila.
// ============================================================

const resolverSchema = z.object({
  pedidoId: z.string().min(1),
  acao: z.enum(["MANTER", "ENCERRAR", "REPEDIR"]),
  motivo: z.string().trim().min(3, "Diga por que o saldo não veio — o fornecedor vai perguntar."),
  itemIds: z.array(z.string()).optional(),
  enviarNovoPedido: z.boolean().default(false),
});

export async function carregarSaldoPedidoAction(pedidoId: string): Promise<SaldoPedido | null> {
  const ctx = await guardAction("compras.ver");
  return runWithTenant(ctx.tenant.id, () => saldoDoPedido(pedidoId));
}

export async function resolverSaldoPedidoAction(
  input: z.input<typeof resolverSchema>,
): Promise<ResultadoSaldo> {
  const d = resolverSchema.parse(input);
  // REPEDIR cria pedido novo, então exige a permissão de pedir; encerrar é
  // decisão de quem recebe.
  const ctx = await guardAction(d.acao === "REPEDIR" ? "compras.pedir" : "compras.receber");

  return runWithTenant(ctx.tenant.id, async () => {
    const pedido = await db.purchaseOrder.findFirst({
      where: { id: d.pedidoId },
      select: { siteId: true },
    });
    if (!pedido) throw new Error("Pedido não encontrado.");
    assertSite(ctx, d.acao === "REPEDIR" ? "compras.pedir" : "compras.receber", pedido.siteId);

    const r = await resolverSaldoPedido({
      tenantId: ctx.tenant.id,
      pedidoId: d.pedidoId,
      acao: d.acao,
      motivo: d.motivo,
      itemIds: d.itemIds,
      enviarNovoPedido: d.enviarNovoPedido,
      userId: ctx.user.id,
    });

    revalidatePath("/pedidos", "layout");
    revalidatePath("/cotacoes", "layout");
    revalidatePath("/estoque", "layout");
    return r;
  });
}
