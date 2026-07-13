"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { confirmarPagamentoVenda } from "@/lib/vendas";
import { caixaAbertoNoSite } from "@/lib/caixa";
import { tierFromGasto, TIERS } from "@/lib/customers";

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const soDigitos = (s: string) => s.replace(/\D/g, "");

/** Só vendas efetivadas contam para fidelização/histórico. */
const PAGA = { status: "PAGA" as const };

// ── Terminal (aparelho físico) ───────────────────────────────
// O quiosque se registra no primeiro uso (id fica no localStorage do aparelho)
// e envia heartbeat periódico. O retorno também informa se há caixa aberto no
// site — sem caixa responsável, o terminal não inicia novas vendas.
export type TerminalStatus = { id: string; nome: string; caixaAberto: boolean };

export async function registrarTerminalAction(input: {
  siteId: string;
  deviceId: string | null;
}): Promise<TerminalStatus> {
  const ctx = await requireActiveTenant();
  return runWithTenant(ctx.tenant.id, async () => {
    let device = input.deviceId
      ? await db.totemDevice.findFirst({
          where: { id: input.deviceId, siteId: input.siteId },
          select: { id: true, nome: true },
        })
      : null;

    if (device) {
      await db.totemDevice.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date() },
      });
    } else {
      const total = await db.totemDevice.count({ where: { siteId: input.siteId } });
      device = await db.totemDevice.create({
        data: {
          tenantId: ctx.tenant.id,
          siteId: input.siteId,
          nome: `Terminal ${String(total + 1).padStart(2, "0")}`,
        },
        select: { id: true, nome: true },
      });
    }

    const caixaAberto = await caixaAbertoNoSite(ctx.tenant.id, input.siteId);
    return { ...device, caixaAberto };
  });
}

/** Verifica o PIN de saída do quiosque. Sem PIN configurado, a saída é livre. */
export async function verifyTotemPinAction(pin: string): Promise<boolean> {
  const ctx = await requireActiveTenant();
  if (!ctx.tenant.totemPinHash) return true;
  return bcrypt.compare(pin, ctx.tenant.totemPinHash);
}

// ── Perfil do cliente para personalizar o totem ──────────────
export type PerfilTotem = {
  id: string;
  nome: string;
  primeiroNome: string;
  pontos: number;
  totalGasto: number;
  numCompras: number;
  ultimaCompra: string | null;
  tier: { label: string; estrelas: number; proximaMeta: number | null; faltam: number | null };
  favoritos: string[]; // productIds mais comprados
  comprarNovamente: string[]; // productIds da última compra
};

async function montarPerfil(customer: {
  id: string;
  nome: string;
  pontos: number;
}): Promise<PerfilTotem> {
  const [sales, favAgg] = await Promise.all([
    db.sale.findMany({
      where: { ...PAGA, customerId: customer.id },
      select: { total: true, paidAt: true, id: true },
      orderBy: { paidAt: "desc" },
    }),
    db.saleItem.groupBy({
      by: ["productId"],
      where: { sale: { ...PAGA, customerId: customer.id } },
      _sum: { quantidade: true },
      orderBy: { _sum: { quantidade: "desc" } },
      take: 8,
    }),
  ]);

  const totalGasto = sales.reduce((s, v) => s + num(v.total), 0);
  const ultima = sales[0] ?? null;
  const tier = tierFromGasto(totalGasto);

  // Próxima meta = próximo tier acima na escada (menor minGasto ainda não atingido).
  const acima = [...TIERS].reverse().find((t) => t.minGasto > totalGasto);
  const proximaMeta = acima?.minGasto ?? null;

  // "Comprar novamente" = itens da última venda paga.
  const comprarNovamente = ultima
    ? (
        await db.saleItem.findMany({
          where: { saleId: ultima.id },
          select: { productId: true },
        })
      ).map((i) => i.productId)
    : [];

  const primeiroNome = customer.nome.trim().split(/\s+/)[0] ?? customer.nome;

  return {
    id: customer.id,
    nome: customer.nome,
    primeiroNome,
    pontos: customer.pontos,
    totalGasto,
    numCompras: sales.length,
    ultimaCompra: ultima?.paidAt ? ultima.paidAt.toISOString() : null,
    tier: {
      label: tier.label,
      estrelas: tier.estrelas,
      proximaMeta,
      faltam: proximaMeta != null ? Math.max(0, proximaMeta - totalGasto) : null,
    },
    favoritos: favAgg.map((f) => f.productId),
    comprarNovamente: [...new Set(comprarNovamente)],
  };
}

/** Busca o cliente por CPF. Retorna null se não cadastrado. */
export async function identificarClienteAction(cpfRaw: string): Promise<PerfilTotem | null> {
  const cpf = soDigitos(cpfRaw);
  if (cpf.length !== 11) throw new Error("Digite os 11 dígitos do CPF.");
  const ctx = await requireActiveTenant();
  return runWithTenant(ctx.tenant.id, async () => {
    const customer = await db.customer.findFirst({
      where: { cpf, ativo: true },
      select: { id: true, nome: true, pontos: true },
    });
    if (!customer) return null;
    return montarPerfil(customer);
  });
}

// ── Cadastro rápido (< 30s): nome, CPF, telefone ─────────────
const cadastroSchema = z.object({
  nome: z.string().trim().min(2, "Informe seu nome."),
  cpf: z.string().transform(soDigitos).refine((v) => v.length === 11, "CPF inválido."),
  telefone: z.string().transform(soDigitos).refine((v) => v.length >= 10 && v.length <= 11, "Telefone inválido."),
});

/** Checagem de duplicidade para o wizard (CPF/telefone já usados por cliente ativo). */
export async function cadastroDisponivelAction(input: { cpf?: string; telefone?: string }): Promise<{ cpfEmUso: boolean; telefoneEmUso: boolean }> {
  const ctx = await requireActiveTenant();
  const cpf = input.cpf ? soDigitos(input.cpf) : null;
  const tel = input.telefone ? soDigitos(input.telefone) : null;
  return runWithTenant(ctx.tenant.id, async () => {
    const [porCpf, porTel] = await Promise.all([
      cpf ? db.customer.findFirst({ where: { cpf, ativo: true }, select: { id: true } }) : null,
      tel ? db.customer.findFirst({ where: { whatsapp: tel, ativo: true }, select: { id: true } }) : null,
    ]);
    return { cpfEmUso: !!porCpf, telefoneEmUso: !!porTel };
  });
}

export async function cadastroRapidoAction(input: z.input<typeof cadastroSchema>): Promise<PerfilTotem> {
  const d = cadastroSchema.parse(input);
  const ctx = await requireActiveTenant();
  return runWithTenant(ctx.tenant.id, async () => {
    const existente = await db.customer.findFirst({
      where: { cpf: d.cpf },
      select: { id: true, nome: true, pontos: true, ativo: true },
    });
    if (existente) {
      if (existente.ativo) throw new Error("CPF já cadastrado. Toque em Voltar e use “Já sou cliente”.");
      // Cliente desativado: reativa em vez de duplicar o cadastro.
      await db.customer.update({ where: { id: existente.id }, data: { ativo: true } });
      return montarPerfil(existente);
    }
    const telEmUso = await db.customer.findFirst({
      where: { whatsapp: d.telefone, ativo: true },
      select: { id: true },
    });
    if (telEmUso) throw new Error("Telefone já cadastrado em outra conta. Confira o número ou use “Já sou cliente”.");
    const criado = await db.customer.create({
      data: { tenantId: ctx.tenant.id, nome: d.nome, cpf: d.cpf, whatsapp: d.telefone },
      select: { id: true, nome: true, pontos: true },
    });
    return montarPerfil(criado);
  });
}

// ── Confirmação de pagamento + fidelidade ────────────────────
export type ResultadoTotem = { numero: string; pontosGanhos: number; saldoPontos: number };

/**
 * Confirma o pagamento pendente da venda do totem e, se houver cliente
 * vinculado, credita pontos (1 ponto por R$ 1 gasto). Idempotente no
 * pagamento; o crédito de pontos só ocorre na primeira confirmação.
 */
export async function finalizarTotemAction(saleId: string): Promise<ResultadoTotem> {
  const ctx = await requireActiveTenant();
  return runWithTenant(ctx.tenant.id, async () => {
    const sale = await db.sale.findFirst({
      where: { id: saleId },
      select: { id: true, total: true, customerId: true, status: true },
    });
    if (!sale) throw new Error("Venda não encontrada.");

    const jaEstavaPaga = sale.status === "PAGA";
    await confirmarPagamentoVenda(ctx.tenant.id, saleId, ctx.user.id ?? undefined);

    let pontosGanhos = 0;
    let saldoPontos = 0;
    if (sale.customerId) {
      if (!jaEstavaPaga) pontosGanhos = Math.floor(num(sale.total));
      const c = await db.customer.update({
        where: { id: sale.customerId },
        data: pontosGanhos > 0 ? { pontos: { increment: pontosGanhos } } : {},
        select: { pontos: true },
      });
      saldoPontos = c.pontos;
    }

    return { numero: saleId.slice(-6).toUpperCase(), pontosGanhos, saldoPontos };
  });
}
