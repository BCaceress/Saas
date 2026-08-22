"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction, assertSite } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { estornarEntrada, desvincularNotaDaEntrada } from "@/lib/compras/estorno";

// ============================================================
// Desfazer. A operação que faltava.
//
// Exige `estoque.ajustar` — estorno mexe em saldo, e por isso é a mesma
// permissão do ajuste, não a de receber. Quem confere carga não desfaz lançamento.
// ============================================================

const estornoSchema = z.object({
  purchaseId: z.string().min(1),
  motivo: z.string().trim().min(3, "Diga por que está estornando — isso fica na razão de estoque."),
});

const revalidar = () => {
  revalidatePath("/estoque", "layout");
  revalidatePath("/pedidos", "layout");
  revalidatePath("/fiscal/notas-recebidas");
  revalidatePath("/financeiro", "layout");
};

export async function estornarEntradaAction(input: z.input<typeof estornoSchema>) {
  const d = estornoSchema.parse(input);
  const ctx = await guardAction("estoque.ajustar");

  return runWithTenant(ctx.tenant.id, async () => {
    const entrada = await db.purchase.findFirst({
      where: { id: d.purchaseId },
      select: { siteId: true },
    });
    if (!entrada) throw new Error("Entrada não encontrada.");
    assertSite(ctx, "estoque.ajustar", entrada.siteId);

    const r = await estornarEntrada({
      tenantId: ctx.tenant.id,
      purchaseId: d.purchaseId,
      motivo: d.motivo,
      userId: ctx.user.id,
    });
    revalidar();
    return r;
  });
}

const desvincularSchema = z.object({
  inboundId: z.string().min(1),
  motivo: z.string().trim().min(3, "Diga por que o vínculo está errado."),
});

/** Desfaz "esta nota documenta aquela entrada". Não toca no estoque. */
export async function desvincularNotaAction(input: z.input<typeof desvincularSchema>) {
  const d = desvincularSchema.parse(input);
  const ctx = await guardAction("fiscal.importar");

  return runWithTenant(ctx.tenant.id, async () => {
    const nota = await db.fiscalInbound.findFirst({
      where: { id: d.inboundId },
      select: { siteId: true },
    });
    if (!nota) throw new Error("Nota não encontrada.");
    assertSite(ctx, "fiscal.importar", nota.siteId);

    await desvincularNotaDaEntrada({
      tenantId: ctx.tenant.id,
      inboundId: d.inboundId,
      motivo: d.motivo,
      userId: ctx.user.id,
    });
    revalidar();
  });
}

/** A entrada que uma nota gerou — a tela precisa disso para oferecer o estorno. */
export async function entradaDaNotaAction(inboundId: string) {
  const ctx = await guardAction("estoque.ver");
  return runWithTenant(ctx.tenant.id, async () => {
    const nota = await db.fiscalInbound.findFirst({
      where: { id: inboundId },
      select: {
        purchaseId: true,
        purchase: {
          select: {
            id: true,
            data: true,
            estornadaEm: true,
            items: { select: { custoTotal: true } },
          },
        },
      },
    });
    if (!nota?.purchase) return null;
    return {
      id: nota.purchase.id,
      data: nota.purchase.data,
      estornada: Boolean(nota.purchase.estornadaEm),
      valor: nota.purchase.items.reduce((a, i) => a + Number(i.custoTotal), 0),
      itens: nota.purchase.items.length,
    };
  });
}
