import "server-only";
import { basePrisma } from "./prisma";
import type { PaymentMethod } from "@/generated/prisma";

// ============================================================
// Caixa do PDV (PRD Fase 4 §7). Um turno = uma CashSession (operador + site).
// Abertura / sangria / suprimento / fechamento. Relatório X (parcial) / Z (final).
// ============================================================

const num = (v: unknown): number => (v == null ? 0 : Number(v));

async function setTenant(tx: { $executeRaw: (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> }, tenantId: string) {
  await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`;
}

export async function sessaoAtual(tenantId: string, siteId: string, operatorUserId: string) {
  return basePrisma.cashSession.findFirst({
    where: { tenantId, siteId, operatorUserId, status: "ABERTA" },
  });
}

export async function abrirCaixa(
  tenantId: string,
  siteId: string,
  operatorUserId: string,
  valorAbertura: number
): Promise<string> {
  const aberta = await sessaoAtual(tenantId, siteId, operatorUserId);
  if (aberta) throw new Error("Já existe um caixa aberto para este operador neste site.");

  return basePrisma.$transaction(async (tx) => {
    await setTenant(tx, tenantId);
    const sessao = await tx.cashSession.create({
      data: { tenantId, siteId, operatorUserId, valorAbertura, status: "ABERTA" },
    });
    await tx.cashMovement.create({
      data: { tenantId, cashSessionId: sessao.id, tipo: "ABERTURA", valor: valorAbertura },
    });
    return sessao.id;
  });
}

export async function registrarMovimentoCaixa(
  tenantId: string,
  cashSessionId: string,
  tipo: "SANGRIA" | "SUPRIMENTO",
  valor: number,
  motivo: string
): Promise<void> {
  if (valor <= 0) throw new Error("Informe um valor maior que zero.");
  const sessao = await basePrisma.cashSession.findFirst({
    where: { id: cashSessionId, tenantId, status: "ABERTA" },
    select: { id: true },
  });
  if (!sessao) throw new Error("Caixa fechado — abra o caixa para movimentar.");

  await basePrisma.$transaction([
    basePrisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`,
    basePrisma.cashMovement.create({
      data: { tenantId, cashSessionId, tipo, valor, motivo },
    }),
  ]);
}

export type FechamentoReport = {
  sessaoId: string;
  valorAbertura: number;
  suprimentos: number;
  sangrias: number;
  vendasDinheiro: number;
  esperadoDinheiro: number;
  totalPorMetodo: Record<string, number>;
  numVendas: number;
  contado: number | null; // valorFechamento, se fechada
  quebra: number | null; // contado - esperado
};

/** Relatório X (parcial, sessão aberta) ou Z (final, após fechar). */
export async function relatorioCaixa(
  tenantId: string,
  cashSessionId: string
): Promise<FechamentoReport> {
  const sessao = await basePrisma.cashSession.findFirst({
    where: { id: cashSessionId, tenantId },
    include: {
      movements: { select: { tipo: true, valor: true } },
      sales: {
        where: { status: "PAGA" },
        select: { payments: { where: { status: "CONFIRMADO" }, select: { metodo: true, valor: true, troco: true } } },
      },
    },
  });
  if (!sessao) throw new Error("Sessão de caixa não encontrada.");

  let suprimentos = 0;
  let sangrias = 0;
  for (const m of sessao.movements) {
    if (m.tipo === "SUPRIMENTO") suprimentos += num(m.valor);
    if (m.tipo === "SANGRIA") sangrias += num(m.valor);
  }

  const totalPorMetodo: Record<string, number> = {};
  let vendasDinheiro = 0;
  for (const venda of sessao.sales) {
    for (const p of venda.payments) {
      const metodo = p.metodo as PaymentMethod;
      // dinheiro entra líquido de troco na gaveta
      const liquido = metodo === "DINHEIRO" ? num(p.valor) - num(p.troco) : num(p.valor);
      totalPorMetodo[metodo] = (totalPorMetodo[metodo] ?? 0) + liquido;
      if (metodo === "DINHEIRO") vendasDinheiro += liquido;
    }
  }

  const valorAbertura = num(sessao.valorAbertura);
  const esperadoDinheiro = valorAbertura + suprimentos - sangrias + vendasDinheiro;
  const contado = sessao.valorFechamento != null ? num(sessao.valorFechamento) : null;

  return {
    sessaoId: sessao.id,
    valorAbertura,
    suprimentos,
    sangrias,
    vendasDinheiro,
    esperadoDinheiro,
    totalPorMetodo,
    numVendas: sessao.sales.length,
    contado,
    quebra: contado != null ? contado - esperadoDinheiro : null,
  };
}

export async function fecharCaixa(
  tenantId: string,
  cashSessionId: string,
  valorFechamento: number
): Promise<FechamentoReport> {
  const sessao = await basePrisma.cashSession.findFirst({
    where: { id: cashSessionId, tenantId, status: "ABERTA" },
    select: { id: true },
  });
  if (!sessao) throw new Error("Caixa já fechado ou inexistente.");

  await basePrisma.$transaction(async (tx) => {
    await setTenant(tx, tenantId);
    await tx.cashSession.update({
      where: { id: cashSessionId },
      data: { status: "FECHADA", valorFechamento, fechadaEm: new Date() },
    });
    await tx.cashMovement.create({
      data: { tenantId, cashSessionId, tipo: "FECHAMENTO", valor: valorFechamento },
    });
  });

  return relatorioCaixa(tenantId, cashSessionId);
}
