"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runWithTenant } from "@/lib/tenant-context";
import { abrirCaixa, registrarMovimentoCaixa, fecharCaixa } from "@/lib/caixa";
import { db } from "@/lib/prisma";
import { guardAction, assertSite } from "@/lib/guard";
import type { Permissao } from "@/lib/permissoes";

/** Toda ação de caixa é da LOJA daquele caixa — o escopo por loja vale aqui. */
async function txp<T>(
  permissao: Permissao,
  siteId: string,
  fn: (tid: string, userId: string) => Promise<T>,
): Promise<T> {
  const ctx = await guardAction(permissao, siteId);
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id, ctx.user.id ?? ""));
}

/** Ações que recebem só o id da sessão: a loja vem do registro. */
async function txpSessao<T>(
  permissao: Permissao,
  cashSessionId: string,
  fn: (tid: string, userId: string) => Promise<T>,
): Promise<T> {
  const ctx = await guardAction(permissao);
  return runWithTenant(ctx.tenant.id, async () => {
    const s = await db.cashSession.findFirst({
      where: { id: cashSessionId },
      select: { siteId: true },
    });
    if (!s) throw new Error("Caixa não encontrado.");
    assertSite(ctx, permissao, s.siteId);
    return fn(ctx.tenant.id, ctx.user.id ?? "");
  });
}

const ok = () => revalidatePath("/vendas", "layout");

const abrirSchema = z.object({
  siteId: z.string().min(1, "Selecione o site."),
  valorAbertura: z.number().nonnegative(),
});

export async function abrirCaixaAction(input: z.input<typeof abrirSchema>) {
  const d = abrirSchema.parse(input);
  return txp("caixa.abrir", d.siteId, async (tid, userId) => {
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
  const d = movSchema.parse(input);
  return txpSessao("caixa.sangria", d.cashSessionId, async (tid) => {
    await registrarMovimentoCaixa(tid, d.cashSessionId, d.tipo, d.valor, d.motivo);
    ok();
  });
}

const fecharSchema = z.object({
  cashSessionId: z.string().min(1),
  valorFechamento: z.number().nonnegative(),
});

export async function fecharCaixaAction(input: z.input<typeof fecharSchema>) {
  const d = fecharSchema.parse(input);
  return txpSessao("caixa.fechar", d.cashSessionId, async (tid) => {
    const report = await fecharCaixa(tid, d.cashSessionId, d.valorFechamento);
    ok();
    return report;
  });
}
