"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { guardAction, assertSite } from "@/lib/guard";
import type { Permissao } from "@/lib/permissoes";
import { runWithTenant } from "@/lib/tenant-context";
import {
  criarVenda,
  finalizarVenda,
  cancelarVenda,
  confirmarPagamentoVenda,
  receberVendaTotem,
  prepararRecebimentoTotemIntegrado,
  reverterRecebimentoTotem,
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
import type { StatusFiscalVenda } from "@/lib/fiscal/emissao";

/** Baseline do PDV. Operações de uma loja usam `txp`; cancelar exige mais. */
async function tx<T>(fn: (tid: string, userId: string) => Promise<T>): Promise<T> {
  const ctx = await guardAction("venda.registrar");
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id, ctx.user.id ?? ""));
}

async function txp<T>(
  permissao: Permissao,
  siteId: string,
  fn: (tid: string, userId: string) => Promise<T>,
): Promise<T> {
  const ctx = await guardAction(permissao, siteId);
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id, ctx.user.id ?? ""));
}

/** Ações que só recebem o id da venda: a loja vem do registro. */
async function txpVenda<T>(
  permissao: Permissao,
  saleId: string,
  fn: (tid: string, userId: string) => Promise<T>,
): Promise<T> {
  const ctx = await guardAction(permissao);
  return runWithTenant(ctx.tenant.id, async () => {
    const s = await db.sale.findFirst({ where: { id: saleId }, select: { siteId: true } });
    if (!s) throw new Error("Venda não encontrada.");
    assertSite(ctx, permissao, s.siteId);
    return fn(ctx.tenant.id, ctx.user.id ?? "");
  });
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

// "CPF na nota": opcional, mas se vier tem que ser um CPF de 11 dígitos —
// mandar lixo ao dest da NFC-e é rejeição garantida na SEFAZ. Normaliza para só
// dígitos; vazio vira null (consumidor anônimo, o caso normal do balcão).
const cpfNotaField = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ?? "").replace(/\D/g, ""))
  .refine((v) => v === "" || v.length === 11, "CPF na nota inválido — informe 11 dígitos.")
  .transform((v) => (v === "" ? null : v));

// ── PDV: finaliza a venda completa numa ação (carrinho client-side) ──
const finalizarPdvSchema = z.object({
  siteId: z.string().min(1, "Selecione o site."),
  customerId: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1, "Adicione ao menos um item."),
  descontoVenda: z.number().nonnegative().default(0),
  maiorIdadeConfirmada: z.boolean().default(false),
  cpfNota: cpfNotaField,
  pagamentos: z.array(pagamentoSchema).min(1, "Registre ao menos um pagamento."),
});

export async function finalizarVendaPdvAction(input: z.input<typeof finalizarPdvSchema>) {
  const d = finalizarPdvSchema.parse(input);
  return txp("venda.registrar", d.siteId, async (tid, userId) => {
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
      cpfNota: d.cpfNota,
      pagamentos: d.pagamentos.map((p) => ({ ...p, status: "CONFIRMADO" as const })),
    });
    await finalizarVenda(tid, saleId, userId);
    ok();
    return saleId;
  });
}

/**
 * Situação da NFC-e de uma venda — o PDV consulta em loop curto logo após
 * fechar. A consulta também EMPURRA a transmissão: quem acabou de vender está
 * com a tela aberta, e é o melhor momento para gastar o tempo de rede.
 */
export async function statusFiscalVendaAction(saleId: string): Promise<StatusFiscalVenda> {
  return txpVenda("venda.registrar", saleId, async (tid) => {
    const { statusFiscalDaVenda } = await import("@/lib/fiscal/emissao");
    return statusFiscalDaVenda(tid, saleId);
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
  /**
   * MISTO: a divisão completa da venda. A perna cujo método == `metodo` (o
   * cartão) nasce PENDENTE e vai à maquininha; as demais (dinheiro/PIX/…)
   * nascem CONFIRMADO. Ausente = venda de um método só (o caminho normal).
   */
  pagamentos: z.array(pagamentoSchema).optional(),
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
  const d = iniciarIntegradoSchema.parse(input);
  return txp("venda.registrar", d.siteId, async (tid, userId) => {
    const sessao = await sessaoAtual(tid, d.siteId, userId);
    if (!sessao) throw new Error("Caixa fechado — abra o caixa para vender.");

    const integracao = await integracaoPdv(tid, d.siteId);
    const ehPix = d.metodo === "PIX";
    if (ehPix && !integracao.pixAutomatico) return { integrado: false };
    if (!ehPix && !integracao.cartaoIntegrado) return { integrado: false };

    // MISTO: divide a venda em várias pernas. A perna do cartão (== d.metodo)
    // fica PENDENTE para ir à maquininha; o resto entra CONFIRMADO. Exatamente
    // UMA perna pendente — duas travariam a venda (nunca cobririam o total).
    const ehMisto = !!d.pagamentos && d.pagamentos.length > 0;
    if (ehMisto) {
      if (ehPix) throw new Error("No misto, a perna integrada é sempre o cartão.");
      const pendentes = d.pagamentos!.filter((p) => p.metodo === d.metodo);
      if (pendentes.length !== 1) {
        throw new Error("O misto integrado aceita exatamente uma perna de cartão na maquininha.");
      }
    }

    const saleId = await criarVenda(tid, {
      siteId: d.siteId,
      origem: "PDV",
      cashSessionId: sessao.id,
      operatorUserId: userId,
      customerId: d.customerId ?? null,
      items: d.items,
      descontoVenda: d.descontoVenda,
      maiorIdadeConfirmada: d.maiorIdadeConfirmada,
      cpfNota: d.cpfNota,
      ...(ehMisto
        ? {
            pagamentos: d.pagamentos!.map((p) => ({
              metodo: p.metodo,
              valor: p.valor,
              troco: p.troco ?? null,
              // só a perna do cartão espera a maquininha; as outras já entraram
              status: p.metodo === d.metodo ? ("PENDENTE" as const) : ("CONFIRMADO" as const),
            })),
          }
        : { pagamentoIntegralPendente: d.metodo }),
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

// Modo B integrado: cobra a venda do totem (já existente) no PSP em vez de
// receber manual. Prepara a venda (itens/sessão + perna PENDENTE) e dispara a
// cobrança; se a cobrança não sai, devolve a venda para a fila.
const iniciarTotemIntegradoSchema = z.object({
  saleId: z.string().min(1),
  siteId: z.string().min(1),
  customerId: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1, "Adicione ao menos um item."),
  maiorIdadeConfirmada: z.boolean().default(false),
  cpfNota: cpfNotaField,
  metodo: z.enum(["PIX", "CARTAO_CREDITO", "CARTAO_DEBITO"]),
  parcelas: z.number().int().min(1).max(12).default(1),
  terminalId: z.string().optional().nullable(),
});

export async function iniciarRecebimentoTotemIntegradoAction(
  input: z.input<typeof iniciarTotemIntegradoSchema>
): Promise<InicioPagamentoIntegrado> {
  const d = iniciarTotemIntegradoSchema.parse(input);
  return txp("venda.registrar", d.siteId, async (tid, userId) => {
    const sessao = await sessaoAtual(tid, d.siteId, userId);
    if (!sessao) throw new Error("Caixa fechado — abra o caixa para receber.");

    const integracao = await integracaoPdv(tid, d.siteId);
    const ehPix = d.metodo === "PIX";
    if (ehPix && !integracao.pixAutomatico) return { integrado: false };
    if (!ehPix && !integracao.cartaoIntegrado) return { integrado: false };

    await prepararRecebimentoTotemIntegrado(tid, {
      saleId: d.saleId,
      cashSessionId: sessao.id,
      operatorUserId: userId,
      customerId: d.customerId ?? null,
      items: d.items,
      maiorIdadeConfirmada: d.maiorIdadeConfirmada,
      cpfNota: d.cpfNota,
      metodo: d.metodo,
    });

    try {
      if (ehPix) {
        const cobranca = await criarCobrancaPixVenda(tid, d.saleId);
        if (!cobranca) throw new Error("Provedor de PIX indisponível.");
        return { integrado: true, tipo: "PIX", saleId: d.saleId, ...cobranca };
      }
      const terminalId = d.terminalId ?? integracao.terminais[0]?.id;
      if (!terminalId) throw new Error("Nenhuma maquininha vinculada a esta loja.");
      const intencao = await criarIntencaoCartaoVenda(tid, d.saleId, {
        terminalId,
        tipo: d.metodo === "CARTAO_CREDITO" ? "CREDITO" : "DEBITO",
        parcelas: d.parcelas,
      });
      if (!intencao) throw new Error("Provedor de cartão indisponível.");
      return { integrado: true, tipo: "CARTAO", saleId: d.saleId, paymentId: intencao.paymentId };
    } catch (e) {
      // cobrança não saiu — devolve a venda do totem para a fila (Modo B)
      await reverterRecebimentoTotem(tid, d.saleId).catch(() => {});
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

// Abort do recebimento integrado de uma venda do TOTEM: cancela a cobrança no
// PSP mas NÃO cancela a venda — ela volta à fila (Modo B) para nova tentativa.
// Cancelar a venda a mandaria para CANCELADA, e o retry no mesmo pedido falharia.
export async function abortarRecebimentoTotemAction(paymentId: string) {
  return tx(async (tid) => {
    const p = await db.payment.findFirst({
      where: { id: paymentId },
      select: { saleId: true },
    });
    await cancelarPagamentoIntegrado(tid, paymentId, { cancelarVendaTambem: false }).catch(
      () => {},
    );
    if (p) await reverterRecebimentoTotem(tid, p.saleId);
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
  const d = totemSchema.parse(input);
  return txp("venda.registrar", d.siteId, async (tid) => {
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
  return txpVenda("venda.registrar", saleId, async (tid) => {
    const r = await confirmarPagamentoVenda(tid, saleId);
    ok();
    return r;
  });
}

export async function cancelarVendaAction(saleId: string) {
  // Cancelar não é registrar: some com receita já lançada.
  return txpVenda("venda.cancelar", saleId, async (tid, userId) => {
    const r = await cancelarVenda(tid, saleId, userId);
    ok();
    // Estorno que o PSP recusou não pode morrer no log — quem cancelou tem
    // que sair da tela sabendo que precisa devolver pelo painel.
    return { pendenciasEstorno: r.pendenciasEstorno };
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
  return txp("venda.registrar", siteId, async () => {
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
  cpfNota: cpfNotaField,
  pagamentos: z.array(pagamentoSchema).min(1, "Registre ao menos um pagamento."),
});

export async function receberVendaTotemAction(input: z.input<typeof receberTotemSchema>) {
  const d = receberTotemSchema.parse(input);
  return txp("venda.registrar", d.siteId, async (tid, userId) => {
    const sessao = await sessaoAtual(tid, d.siteId, userId);
    if (!sessao) throw new Error("Caixa fechado — abra o caixa para receber.");

    await receberVendaTotem(tid, {
      saleId: d.saleId,
      cashSessionId: sessao.id,
      operatorUserId: userId,
      customerId: d.customerId ?? null,
      items: d.items,
      maiorIdadeConfirmada: d.maiorIdadeConfirmada,
      cpfNota: d.cpfNota,
      pagamentos: d.pagamentos.map((p) => ({ ...p, status: "CONFIRMADO" as const })),
    });
    ok();
    return d.saleId;
  });
}

// ── Histórico recente do PDV (para reimprimir cupom / estornar) ──
// Vendas do próprio balcão (origem PDV), pagas na janela recente. É o espelho
// da lista de concluídas do totem, mas para as vendas do operador — que antes
// não tinham onde ser reimpressas nem estornadas depois do fechamento.

export type VendaPdvRecente = {
  id: string;
  numero: string;
  total: number;
  metodo: string | null;
  pagaEm: string; // ISO
  status: "PAGA" | "CANCELADA";
  temCupom: boolean; // NFC-e autorizada → dá para reimprimir
};

export async function pollVendasPdvAction(siteId: string): Promise<VendaPdvRecente[]> {
  return txp("venda.registrar", siteId, async () => {
    const desde = new Date(Date.now() - CONCLUIDA_JANELA_MS);
    const vendas = await db.sale.findMany({
      where: {
        siteId,
        origem: "PDV",
        status: { in: ["PAGA", "CANCELADA"] },
        // pagas recentes ou canceladas recentes (createdAt como piso barato)
        createdAt: { gte: desde },
      },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: {
        id: true,
        total: true,
        status: true,
        paidAt: true,
        createdAt: true,
        payments: {
          where: { status: "CONFIRMADO" },
          select: { metodo: true },
          take: 1,
        },
        fiscalDocs: {
          where: { status: "AUTORIZADO" },
          select: { id: true },
          take: 1,
        },
      },
    });

    return vendas.map((s) => ({
      id: s.id,
      numero: numeroVenda(s.id),
      total: num(s.total),
      metodo: s.payments[0]?.metodo ?? null,
      pagaEm: (s.paidAt ?? s.createdAt).toISOString(),
      status: s.status as "PAGA" | "CANCELADA",
      temCupom: s.fiscalDocs.length > 0,
    }));
  });
}
