"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { abrirCaixa, registrarMovimentoCaixa, fecharCaixa } from "@/lib/caixa";

async function tx<T>(fn: (tid: string, userId: string) => Promise<T>): Promise<T> {
  const ctx = await requireActiveTenant();
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id, ctx.user.id ?? ""));
}

const ok = () => revalidatePath("/vendas", "layout");

const abrirSchema = z.object({
  siteId: z.string().min(1, "Selecione o site."),
  valorAbertura: z.number().nonnegative(),
});

export async function abrirCaixaAction(input: z.input<typeof abrirSchema>) {
  return tx(async (tid, userId) => {
    const d = abrirSchema.parse(input);
    const id = await abrirCaixa(tid, d.siteId, userId, d.valorAbertura);
    ok();
    return id;
  });
}

const movSchema = z.object({
  cashSessionId: z.string().min(1),
  tipo: z.enum(["SANGRIA", "SUPRIMENTO"]),
  valor: z.number().positive("Informe um valor maior que zero."),
  motivo: z.string().min(2, "Informe o motivo."),
});

export async function movimentarCaixaAction(input: z.input<typeof movSchema>) {
  return tx(async (tid) => {
    const d = movSchema.parse(input);
    await registrarMovimentoCaixa(tid, d.cashSessionId, d.tipo, d.valor, d.motivo);
    ok();
  });
}

const fecharSchema = z.object({
  cashSessionId: z.string().min(1),
  valorFechamento: z.number().nonnegative(),
});

export async function fecharCaixaAction(input: z.input<typeof fecharSchema>) {
  return tx(async (tid) => {
    const d = fecharSchema.parse(input);
    const report = await fecharCaixa(tid, d.cashSessionId, d.valorFechamento);
    ok();
    return report;
  });
}
