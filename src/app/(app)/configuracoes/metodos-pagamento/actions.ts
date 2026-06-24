"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { listSitePaymentMethods } from "@/lib/vendas";

async function tx<T>(fn: (tid: string) => Promise<T>): Promise<T> {
  const ctx = await requireActiveTenant();
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id));
}

const schema = z.object({
  siteId: z.string().min(1),
  metodo: z.enum(["DINHEIRO", "CARTAO_CREDITO", "CARTAO_DEBITO", "PIX", "OUTRO"]),
  ativo: z.boolean(),
});

export async function toggleMetodoPagamentoAction(input: z.input<typeof schema>) {
  return tx(async (tid) => {
    const d = schema.parse(input);
    // garante que os defaults existem antes de alternar
    await listSitePaymentMethods(tid, d.siteId);
    const existing = await db.sitePaymentMethod.findFirst({
      where: { siteId: d.siteId, metodo: d.metodo },
      select: { id: true },
    });
    if (existing) {
      await db.sitePaymentMethod.update({ where: { id: existing.id }, data: { ativo: d.ativo } });
    } else {
      await db.sitePaymentMethod.create({
        data: { tenantId: tid, siteId: d.siteId, metodo: d.metodo, ativo: d.ativo },
      });
    }
    revalidatePath("/configuracoes/metodos-pagamento");
  });
}
