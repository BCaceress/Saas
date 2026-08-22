"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import {
  criarTituloReceber,
  receberTitulo,
  cancelarTituloReceber,
} from "@/lib/financeiro/contas-receber";

const revalidar = () => {
  revalidatePath("/financeiro", "layout");
  revalidatePath("/clientes", "layout");
};

const criarSchema = z.object({
  descricao: z.string().trim().min(3, "Diga do que é este recebimento."),
  valor: z.number().positive("Informe o valor."),
  vencimento: z.string().min(8, "Informe o vencimento."),
  customerId: z.string().optional().nullable(),
  numeroDocumento: z.string().trim().max(40).optional().nullable(),
  parcelas: z.number().int().min(1).max(36).default(1),
  origem: z.enum(["MANUAL", "VENDA_PRAZO", "COMODATO", "OUTRO"]).default("MANUAL"),
  observacao: z.string().trim().max(300).optional().nullable(),
});

export async function criarTituloReceberAction(input: z.input<typeof criarSchema>) {
  const d = criarSchema.parse(input);
  const ctx = await guardAction("financeiro.pagar");
  return runWithTenant(ctx.tenant.id, async () => {
    const r = await criarTituloReceber({
      tenantId: ctx.tenant.id,
      descricao: d.descricao,
      valor: d.valor,
      vencimento: new Date(`${d.vencimento}T12:00:00`),
      customerId: d.customerId || null,
      numeroDocumento: d.numeroDocumento || null,
      parcelas: d.parcelas,
      origem: d.origem,
      observacao: d.observacao || null,
      userId: ctx.user.id,
    });
    revalidar();
    return r;
  });
}

const receberSchema = z.object({
  tituloId: z.string().min(1),
  valorRecebido: z.number().positive().optional().nullable(),
  recebidoEm: z.string().optional().nullable(),
  observacao: z.string().trim().max(300).optional().nullable(),
});

export async function receberTituloAction(input: z.input<typeof receberSchema>) {
  const d = receberSchema.parse(input);
  const ctx = await guardAction("financeiro.pagar");
  return runWithTenant(ctx.tenant.id, async () => {
    const r = await receberTitulo({
      tenantId: ctx.tenant.id,
      tituloId: d.tituloId,
      valorRecebido: d.valorRecebido ?? null,
      recebidoEm: d.recebidoEm ? new Date(`${d.recebidoEm}T12:00:00`) : null,
      observacao: d.observacao ?? null,
      userId: ctx.user.id,
    });
    revalidar();
    return r;
  });
}

const cancelarSchema = z.object({
  tituloId: z.string().min(1),
  motivo: z.string().trim().min(3, "Diga por que o título não será recebido."),
});

export async function cancelarTituloReceberAction(input: z.input<typeof cancelarSchema>) {
  const d = cancelarSchema.parse(input);
  const ctx = await guardAction("financeiro.pagar");
  return runWithTenant(ctx.tenant.id, async () => {
    await cancelarTituloReceber(d);
    revalidar();
  });
}

/** Clientes para o seletor do lançamento. Título sem cliente também é válido. */
export async function clientesParaTituloAction(termo: string) {
  const ctx = await guardAction("financeiro.ver");
  return runWithTenant(ctx.tenant.id, async () => {
    const t = termo.trim();
    const clientes = await db.customer.findMany({
      where: t ? { nome: { contains: t, mode: "insensitive" } } : {},
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
      take: 20,
    });
    return clientes;
  });
}
