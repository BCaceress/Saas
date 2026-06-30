"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { criarVenda, finalizarVenda, cancelarVenda, confirmarPagamentoVenda } from "@/lib/vendas";
import { sessaoAtual } from "@/lib/caixa";

async function tx<T>(fn: (tid: string, userId: string) => Promise<T>): Promise<T> {
  const ctx = await requireActiveTenant();
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id, ctx.user.id ?? ""));
}

const ok = () => revalidatePath("/vendas", "layout");

const itemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().optional().nullable(),
  quantidade: z.number().positive(),
  desconto: z.number().nonnegative().optional(),
  /** PERSONALIZADO: componentes escolhidos no PDV (guiam preço e baixa). */
  selecoes: z.array(z.string()).optional().default([]),
});

const pagamentoSchema = z.object({
  metodo: z.enum(["DINHEIRO", "CARTAO_CREDITO", "CARTAO_DEBITO", "PIX", "OUTRO"]),
  valor: z.number().positive(),
  troco: z.number().nonnegative().optional().nullable(),
});

// ── PDV: finaliza a venda completa numa ação (carrinho client-side) ──
const finalizarPdvSchema = z.object({
  siteId: z.string().min(1, "Selecione o site."),
  items: z.array(itemSchema).min(1, "Adicione ao menos um item."),
  descontoVenda: z.number().nonnegative().default(0),
  maiorIdadeConfirmada: z.boolean().default(false),
  pagamentos: z.array(pagamentoSchema).min(1, "Registre ao menos um pagamento."),
});

export async function finalizarVendaPdvAction(input: z.input<typeof finalizarPdvSchema>) {
  return tx(async (tid, userId) => {
    const d = finalizarPdvSchema.parse(input);

    // PDV exige caixa aberto (§7)
    const sessao = await sessaoAtual(tid, d.siteId, userId);
    if (!sessao) throw new Error("Caixa fechado — abra o caixa para vender.");

    const saleId = await criarVenda(tid, {
      siteId: d.siteId,
      origem: "PDV",
      cashSessionId: sessao.id,
      operatorUserId: userId,
      items: d.items,
      descontoVenda: d.descontoVenda,
      maiorIdadeConfirmada: d.maiorIdadeConfirmada,
      pagamentos: d.pagamentos.map((p) => ({ ...p, status: "CONFIRMADO" as const })),
    });
    await finalizarVenda(tid, saleId, userId);
    ok();
    return saleId;
  });
}

// ── Self-service / totem: cria venda + pagamento PIX PENDENTE ──
const totemSchema = z.object({
  siteId: z.string().min(1),
  origem: z.enum(["TOTEM", "APP"]).default("TOTEM"),
  items: z.array(itemSchema).min(1, "Adicione ao menos um item."),
  maiorIdadeConfirmada: z.boolean().default(false),
  metodo: z.enum(["PIX", "CARTAO_CREDITO", "CARTAO_DEBITO"]).default("PIX"),
});

export async function criarVendaTotemAction(input: z.input<typeof totemSchema>) {
  return tx(async (tid) => {
    const d = totemSchema.parse(input);
    const saleId = await criarVenda(tid, {
      siteId: d.siteId,
      origem: d.origem,
      items: d.items,
      maiorIdadeConfirmada: d.maiorIdadeConfirmada,
      pagamentoIntegralPendente: d.metodo,
    });
    ok();
    return saleId;
  });
}

export async function confirmarPagamentoTotemAction(saleId: string) {
  return tx(async (tid) => {
    const r = await confirmarPagamentoVenda(tid, saleId);
    ok();
    return r;
  });
}

export async function cancelarVendaAction(saleId: string) {
  return tx(async (tid, userId) => {
    await cancelarVenda(tid, saleId, userId);
    ok();
  });
}
