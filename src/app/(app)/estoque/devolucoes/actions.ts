"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction, assertSite } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import {
  criarDevolucaoFornecedor,
  confirmarDevolucao,
  cancelarDevolucao,
  itensDaEntrada,
} from "@/lib/compras/devolucao";
import { enfileirarNfeDevolucao, podeEmitirDevolucao } from "@/lib/fiscal/devolucao-nfe";

// ============================================================
// Devolução ao fornecedor — ações da tela.
//
// A devolução de CLIENTE continua onde estava (é ajuste de estoque, entra pelo
// caminho do PDV). Aqui só o lado do fornecedor, que precisa de documento:
// número, motivo, vínculo com a nota que trouxe e crédito no financeiro.
// ============================================================

const itemSchema = z.object({
  productId: z.string().min(1),
  quantidade: z.number().positive(),
  custoUnitario: z.number().nonnegative().optional().nullable(),
  observacao: z.string().trim().optional().nullable(),
});

const criarSchema = z.object({
  siteId: z.string().min(1, "Selecione a loja."),
  supplierId: z.string().min(1, "Selecione o fornecedor."),
  motivo: z.enum(["AVARIA", "VALIDADE", "DIVERGENCIA", "RECUSA", "ACORDO_COMERCIAL", "OUTRO"]),
  observacao: z.string().trim().min(3, "Descreva o motivo — é o que o fornecedor vai ler."),
  itens: z.array(itemSchema).min(1, "Adicione ao menos um item."),
  purchaseId: z.string().optional().nullable(),
  purchaseOrderId: z.string().optional().nullable(),
  inboundId: z.string().optional().nullable(),
  numeroNota: z.string().trim().optional().nullable(),
  confirmar: z.boolean().default(false),
});

const revalidar = () => {
  revalidatePath("/estoque", "layout");
  revalidatePath("/pedidos", "layout");
  revalidatePath("/fornecedores", "layout");
  revalidatePath("/financeiro", "layout");
};

export async function criarDevolucaoAction(input: z.input<typeof criarSchema>) {
  const d = criarSchema.parse(input);
  const ctx = await guardAction("compras.devolver", d.siteId);

  return runWithTenant(ctx.tenant.id, async () => {
    const r = await criarDevolucaoFornecedor({
      tenantId: ctx.tenant.id,
      siteId: d.siteId,
      supplierId: d.supplierId,
      motivo: d.motivo,
      observacao: d.observacao,
      itens: d.itens.map((i) => ({
        productId: i.productId,
        quantidade: i.quantidade,
        custoUnitario: i.custoUnitario ?? null,
        observacao: i.observacao ?? null,
      })),
      purchaseId: d.purchaseId,
      purchaseOrderId: d.purchaseOrderId,
      inboundId: d.inboundId,
      numeroNota: d.numeroNota,
      confirmar: d.confirmar,
      userId: ctx.user.id,
    });
    revalidar();
    return r;
  });
}

export async function confirmarDevolucaoAction(returnId: string) {
  const ctx = await guardAction("compras.devolver");
  return runWithTenant(ctx.tenant.id, async () => {
    const dev = await db.supplierReturn.findFirst({
      where: { id: returnId },
      select: { siteId: true },
    });
    if (!dev) throw new Error("Devolução não encontrada.");
    assertSite(ctx, "compras.devolver", dev.siteId);

    const r = await confirmarDevolucao({
      tenantId: ctx.tenant.id,
      returnId,
      userId: ctx.user.id,
    });
    revalidar();
    return r;
  });
}

const cancelarSchema = z.object({
  returnId: z.string().min(1),
  motivo: z.string().trim().min(3, "Diga por que está cancelando."),
});

export async function cancelarDevolucaoAction(input: z.input<typeof cancelarSchema>) {
  const d = cancelarSchema.parse(input);
  const ctx = await guardAction("compras.devolver");
  return runWithTenant(ctx.tenant.id, async () => {
    const dev = await db.supplierReturn.findFirst({
      where: { id: d.returnId },
      select: { siteId: true },
    });
    if (!dev) throw new Error("Devolução não encontrada.");
    assertSite(ctx, "compras.devolver", dev.siteId);
    await cancelarDevolucao(d);
    revalidar();
  });
}

/**
 * Emite a NF-e de devolução. Separada da confirmação de propósito: a mercadoria
 * sai do estoque hoje e a nota pode sair amanhã (fornecedor pede assim, ou a
 * loja ainda não configurou série de NF-e). Amarrar as duas travaria a operação
 * física por causa de configuração fiscal.
 */
export async function emitirNfeDevolucaoAction(returnId: string) {
  const ctx = await guardAction("fiscal.emitir");
  return runWithTenant(ctx.tenant.id, async () => {
    const dev = await db.supplierReturn.findFirst({
      where: { id: returnId },
      select: { siteId: true },
    });
    if (!dev) throw new Error("Devolução não encontrada.");
    assertSite(ctx, "fiscal.emitir", dev.siteId);

    const r = await enfileirarNfeDevolucao(ctx.tenant.id, returnId, ctx.user.id);
    if (!r.ok) throw new Error(r.motivo);
    revalidar();
    revalidatePath("/fiscal/notas-emitidas");
    return r;
  });
}

/** Esta loja consegue emitir NF-e? A tela não oferece o que não dá. */
export async function podeEmitirDevolucaoAction(siteId: string) {
  const ctx = await guardAction("compras.devolver", siteId);
  return runWithTenant(ctx.tenant.id, () => podeEmitirDevolucao(ctx.tenant.id, siteId));
}

/** Itens de uma entrada, para o operador marcar o que volta. */
export async function itensDaEntradaAction(purchaseId: string) {
  const ctx = await guardAction("compras.devolver");
  return runWithTenant(ctx.tenant.id, () => itensDaEntrada(purchaseId));
}

/** Últimas entradas deste fornecedor — a devolução quase sempre aponta para uma. */
export async function entradasDoFornecedorAction(supplierId: string, siteId: string) {
  const ctx = await guardAction("compras.devolver", siteId);
  return runWithTenant(ctx.tenant.id, async () => {
    const entradas = await db.purchase.findMany({
      where: { supplierId, siteId },
      select: {
        id: true,
        data: true,
        numeroNota: true,
        purchaseOrderId: true,
        purchaseOrder: { select: { numero: true } },
        fiscalInbound: { select: { id: true } },
        items: { select: { custoTotal: true } },
      },
      orderBy: { data: "desc" },
      take: 15,
    });
    return entradas.map((e) => ({
      id: e.id,
      data: e.data,
      numeroNota: e.numeroNota,
      pedidoNumero: e.purchaseOrder?.numero ?? null,
      purchaseOrderId: e.purchaseOrderId,
      inboundId: e.fiscalInbound?.id ?? null,
      valor: e.items.reduce((a, i) => a + Number(i.custoTotal), 0),
      itens: e.items.length,
    }));
  });
}
