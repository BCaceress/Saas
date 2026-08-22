"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { pagarTitulo, cancelarTitulo } from "@/lib/financeiro/contas-pagar";

const pagarSchema = z.object({
  tituloId: z.string().min(1),
  /** Vazio = quita o saldo restante. Preenchido = pagamento parcial. */
  valorPago: z.number().positive().optional().nullable(),
  pagoEm: z.string().optional().nullable(),
  observacao: z.string().trim().max(300).optional().nullable(),
});

const revalidar = () => {
  revalidatePath("/financeiro", "layout");
  revalidatePath("/fornecedores", "layout");
};

export async function pagarTituloAction(input: z.input<typeof pagarSchema>) {
  const d = pagarSchema.parse(input);
  const ctx = await guardAction("financeiro.pagar");
  return runWithTenant(ctx.tenant.id, async () => {
    const r = await pagarTitulo({
      tenantId: ctx.tenant.id,
      tituloId: d.tituloId,
      valorPago: d.valorPago ?? null,
      pagoEm: d.pagoEm ? new Date(`${d.pagoEm}T12:00:00`) : null,
      observacao: d.observacao ?? null,
      userId: ctx.user.id,
    });
    revalidar();
    return r;
  });
}

const cancelarSchema = z.object({
  tituloId: z.string().min(1),
  motivo: z.string().trim().min(3, "Diga por que o título não deve ser pago."),
});

export async function cancelarTituloAction(input: z.input<typeof cancelarSchema>) {
  const d = cancelarSchema.parse(input);
  const ctx = await guardAction("financeiro.pagar");
  return runWithTenant(ctx.tenant.id, async () => {
    await cancelarTitulo(d);
    revalidar();
  });
}
