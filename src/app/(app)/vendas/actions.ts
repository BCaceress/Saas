"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import {
  criarVenda,
  finalizarVenda,
  cancelarVenda,
  confirmarPagamentoVenda,
  receberVendaTotem,
} from "@/lib/vendas";
import { sessaoAtual, caixaAbertoNoSite } from "@/lib/caixa";
import { db } from "@/lib/prisma";
import {
  criarCobrancaPixVenda,
  criarIntencaoCartaoVenda,
  sincronizarPagamentoIntegrado,
  cancelarPagamentoIntegrado,
  integracaoPdv,
} from "@/lib/pagamentos";
import type { PaymentStatus } from "@/generated/prisma";

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
  customerId: z.string().optional().nullable(),
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
      customerId: d.customerId ?? null,
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

// ============================================================
// Pagamento integrado no PDV (PIX dinâmico + maquininha via API).
// Fluxo: cria a venda ABERTA com pagamento PENDENTE → cria a cobrança/
// intenção no PSP → o modal faz polling até CONFIRMADO → a venda
// finaliza sozinha (baixa + fiscal). NUNCA finaliza só porque o QR
// foi gerado — apenas após confirmação do provedor.
// ============================================================

const iniciarIntegradoSchema = finalizarPdvSchema.omit({ pagamentos: true }).extend({
  metodo: z.enum(["PIX", "CARTAO_CREDITO", "CARTAO_DEBITO"]),
  parcelas: z.number().int().min(1).max(12).default(1),
  terminalId: z.string().optional().nullable(),
});

export type InicioPagamentoIntegrado =
  | { integrado: false }
  | {
      integrado: true;
      tipo: "PIX";
      saleId: string;
      paymentId: string;
      copiaECola: string;
      qrCodeBase64: string | null;
      expiraEm: string | null;
    }
  | { integrado: true; tipo: "CARTAO"; saleId: string; paymentId: string };

export async function iniciarPagamentoIntegradoAction(
  input: z.input<typeof iniciarIntegradoSchema>
): Promise<InicioPagamentoIntegrado> {
  return tx(async (tid, userId) => {
    const d = iniciarIntegradoSchema.parse(input);

    const sessao = await sessaoAtual(tid, d.siteId, userId);
    if (!sessao) throw new Error("Caixa fechado — abra o caixa para vender.");

    const integracao = await integracaoPdv(tid, d.siteId);
    const ehPix = d.metodo === "PIX";
    if (ehPix && !integracao.pixAutomatico) return { integrado: false };
    if (!ehPix && !integracao.cartaoIntegrado) return { integrado: false };

    const saleId = await criarVenda(tid, {
      siteId: d.siteId,
      origem: "PDV",
      cashSessionId: sessao.id,
      operatorUserId: userId,
      customerId: d.customerId ?? null,
      items: d.items,
      descontoVenda: d.descontoVenda,
      maiorIdadeConfirmada: d.maiorIdadeConfirmada,
      pagamentoIntegralPendente: d.metodo,
    });

    try {
      if (ehPix) {
        const cobranca = await criarCobrancaPixVenda(tid, saleId);
        if (!cobranca) throw new Error("Provedor de PIX indisponível.");
        return { integrado: true, tipo: "PIX", saleId, ...cobranca };
      }
      const terminalId = d.terminalId ?? integracao.terminais[0]?.id;
      if (!terminalId) throw new Error("Nenhuma maquininha vinculada a esta loja.");
      const intencao = await criarIntencaoCartaoVenda(tid, saleId, {
        terminalId,
        tipo: d.metodo === "CARTAO_CREDITO" ? "CREDITO" : "DEBITO",
        parcelas: d.parcelas,
      });
      if (!intencao) throw new Error("Provedor de cartão indisponível.");
      return { integrado: true, tipo: "CARTAO", saleId, paymentId: intencao.paymentId };
    } catch (e) {
      // cobrança não saiu — não deixa venda ABERTA órfã para trás
      await cancelarVenda(tid, saleId, userId).catch(() => {});
      throw e;
    }
  });
}

export async function statusPagamentoIntegradoAction(
  paymentId: string
): Promise<{ status: PaymentStatus; erroFinalizacao?: string }> {
  return tx(async (tid, userId) => {
    const r = await sincronizarPagamentoIntegrado(tid, paymentId, userId);
    if (r.status === "CONFIRMADO") ok();
    return r;
  });
}

export async function cancelarPagamentoIntegradoAction(paymentId: string) {
  return tx(async (tid, userId) => {
    await cancelarPagamentoIntegrado(tid, paymentId, {
      cancelarVendaTambem: true,
      createdBy: userId,
    });
    ok();
  });
}

// ── Self-service / totem ──
// Modo A (pagamento no terminal): cria venda + pagamento PENDENTE.
// Modo B (pagarNoCaixa): cria venda ABERTA sem pagamento — entra na fila do PDV.
const totemSchema = z.object({
  siteId: z.string().min(1),
  origem: z.enum(["TOTEM", "APP"]).default("TOTEM"),
  customerId: z.string().optional().nullable(),
  totemDeviceId: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1, "Adicione ao menos um item."),
  maiorIdadeConfirmada: z.boolean().default(false),
  metodo: z.enum(["PIX", "CARTAO_CREDITO", "CARTAO_DEBITO", "DINHEIRO"]).optional(),
  pagarNoCaixa: z.boolean().default(false),
});

export async function criarVendaTotemAction(input: z.input<typeof totemSchema>) {
  return tx(async (tid) => {
    const d = totemSchema.parse(input);

    // Autoatendimento só opera com um caixa responsável aberto no site.
    const aberto = await caixaAbertoNoSite(tid, d.siteId);
    if (!aberto) throw new Error("Terminal indisponível — nenhum caixa aberto na loja.");

    const saleId = await criarVenda(tid, {
      siteId: d.siteId,
      origem: d.origem,
      customerId: d.customerId ?? null,
      totemDeviceId: d.totemDeviceId ?? null,
      items: d.items,
      maiorIdadeConfirmada: d.maiorIdadeConfirmada,
      pagamentoIntegralPendente: d.pagarNoCaixa ? undefined : (d.metodo ?? "PIX"),
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

// ============================================================
// Fila do autoatendimento no PDV
// ============================================================

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numeroVenda = (id: string) => "#" + id.slice(-4).toUpperCase();

/** Terminal "ativo" = heartbeat nos últimos 2 minutos. */
const TERMINAL_ATIVO_MS = 2 * 60 * 1000;
/** Vendas pagas no terminal ficam visíveis na fila por 30 minutos. */
const CONCLUIDA_JANELA_MS = 30 * 60 * 1000;

export type VendaTotemFila = {
  id: string;
  numero: string;
  terminal: string | null;
  numItens: number;
  total: number;
  criadaEm: string; // ISO
};

export type VendaTotemConcluida = {
  id: string;
  numero: string;
  terminal: string | null;
  numItens: number;
  total: number;
  metodo: string | null;
  pagaEm: string; // ISO
};

export type FilaAutoatendimento = {
  aguardando: VendaTotemFila[];
  concluidas: VendaTotemConcluida[];
  terminaisAtivos: number;
};

export async function pollAutoatendimentoAction(siteId: string): Promise<FilaAutoatendimento> {
  return tx(async () => {
    const agora = Date.now();
    const [abertas, pagas, terminaisAtivos] = await Promise.all([
      // Modo B: venda ABERTA sem nenhum pagamento = cliente escolheu pagar no caixa.
      db.sale.findMany({
        where: { siteId, origem: "TOTEM", status: "ABERTA", payments: { none: {} } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          total: true,
          createdAt: true,
          totemDevice: { select: { nome: true } },
          items: { select: { quantidade: true } },
        },
      }),
      db.sale.findMany({
        where: {
          siteId,
          origem: "TOTEM",
          status: "PAGA",
          paidAt: { gte: new Date(agora - CONCLUIDA_JANELA_MS) },
        },
        orderBy: { paidAt: "desc" },
        take: 6,
        select: {
          id: true,
          total: true,
          paidAt: true,
          totemDevice: { select: { nome: true } },
          items: { select: { quantidade: true } },
          payments: { where: { status: "CONFIRMADO" }, select: { metodo: true }, take: 1 },
        },
      }),
      db.totemDevice.count({
        where: { siteId, lastSeenAt: { gte: new Date(agora - TERMINAL_ATIVO_MS) } },
      }),
    ]);

    const contaItens = (items: { quantidade: unknown }[]) =>
      items.reduce((s, i) => s + num(i.quantidade), 0);

    return {
      aguardando: abertas.map((s) => ({
        id: s.id,
        numero: numeroVenda(s.id),
        terminal: s.totemDevice?.nome ?? null,
        numItens: contaItens(s.items),
        total: num(s.total),
        criadaEm: s.createdAt.toISOString(),
      })),
      concluidas: pagas.map((s) => ({
        id: s.id,
        numero: numeroVenda(s.id),
        terminal: s.totemDevice?.nome ?? null,
        numItens: contaItens(s.items),
        total: num(s.total),
        metodo: s.payments[0]?.metodo ?? null,
        pagaEm: (s.paidAt ?? new Date()).toISOString(),
      })),
      terminaisAtivos,
    };
  });
}

export type VendaTotemDetalhe = {
  id: string;
  numero: string;
  terminal: string | null;
  maiorIdadeConfirmada: boolean;
  cliente: { id: string; nome: string; cpf: string | null } | null;
  items: {
    productId: string;
    variantId: string | null;
    nome: string;
    variantNome: string | null;
    preco: number;
    quantidade: number;
    restricaoIdade: boolean;
    imagemUrl: string | null;
    selecoes: string[];
    /** PERSONALIZADO: rótulo das escolhas ("Vodka, Gelo, Limão") — a "receita". */
    detalhe: string | null;
  }[];
};

/** Carrega a venda do autoatendimento para o operador conferir e receber. */
export async function carregarVendaTotemAction(saleId: string): Promise<VendaTotemDetalhe> {
  return tx(async () => {
    const sale = await db.sale.findFirst({
      where: { id: saleId, origem: { not: "PDV" } },
      select: {
        id: true,
        status: true,
        maiorIdadeConfirmada: true,
        totemDevice: { select: { nome: true } },
        customer: { select: { id: true, nome: true, cpf: true } },
        items: {
          select: {
            productId: true,
            variantId: true,
            quantidade: true,
            precoUnitario: true,
            selectedComponentIds: true,
          },
        },
      },
    });
    if (!sale) throw new Error("Venda não encontrada.");
    if (sale.status !== "ABERTA") throw new Error("Esta venda já foi recebida ou cancelada.");

    const productIds = [...new Set(sale.items.map((i) => i.productId))];
    const variantIds = sale.items.map((i) => i.variantId).filter(Boolean) as string[];
    const componentIds = [
      ...new Set(sale.items.flatMap((i) => i.selectedComponentIds)),
    ];
    const [products, variants, componentes] = await Promise.all([
      db.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, nome: true, restricaoIdade: true, imagemUrl: true },
      }),
      variantIds.length
        ? db.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: { id: true, nome: true },
          })
        : Promise.resolve([]),
      componentIds.length
        ? db.product.findMany({
            where: { id: { in: componentIds } },
            select: { id: true, nome: true },
          })
        : Promise.resolve([]),
    ]);
    const prodMap = new Map(products.map((p) => [p.id, p]));
    const varMap = new Map(variants.map((v) => [v.id, v]));
    const compMap = new Map(componentes.map((c) => [c.id, c.nome]));

    return {
      id: sale.id,
      numero: numeroVenda(sale.id),
      terminal: sale.totemDevice?.nome ?? null,
      maiorIdadeConfirmada: sale.maiorIdadeConfirmada,
      cliente: sale.customer,
      items: sale.items.map((i) => ({
        productId: i.productId,
        variantId: i.variantId,
        nome: prodMap.get(i.productId)?.nome ?? "Produto",
        variantNome: i.variantId ? (varMap.get(i.variantId)?.nome ?? null) : null,
        preco: num(i.precoUnitario),
        quantidade: num(i.quantidade),
        restricaoIdade: prodMap.get(i.productId)?.restricaoIdade ?? false,
        imagemUrl: prodMap.get(i.productId)?.imagemUrl ?? null,
        selecoes: i.selectedComponentIds,
        detalhe:
          i.selectedComponentIds.map((id) => compMap.get(id) ?? null).filter(Boolean).join(", ") ||
          null,
      })),
    };
  });
}

// ── Recebe (paga) a venda do autoatendimento no caixa — Modo B ──
const receberTotemSchema = z.object({
  saleId: z.string().min(1),
  siteId: z.string().min(1),
  customerId: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1, "Adicione ao menos um item."),
  maiorIdadeConfirmada: z.boolean().default(false),
  pagamentos: z.array(pagamentoSchema).min(1, "Registre ao menos um pagamento."),
});

export async function receberVendaTotemAction(input: z.input<typeof receberTotemSchema>) {
  return tx(async (tid, userId) => {
    const d = receberTotemSchema.parse(input);

    const sessao = await sessaoAtual(tid, d.siteId, userId);
    if (!sessao) throw new Error("Caixa fechado — abra o caixa para receber.");

    await receberVendaTotem(tid, {
      saleId: d.saleId,
      cashSessionId: sessao.id,
      operatorUserId: userId,
      customerId: d.customerId ?? null,
      items: d.items,
      maiorIdadeConfirmada: d.maiorIdadeConfirmada,
      pagamentos: d.pagamentos.map((p) => ({ ...p, status: "CONFIRMADO" as const })),
    });
    ok();
    return d.saleId;
  });
}
