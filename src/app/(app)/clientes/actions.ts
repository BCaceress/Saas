"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/prisma";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { onlyDigits } from "@/lib/normalize";
import { loadCustomerRows, computeInsights, loadCouponCandidates } from "./_data";
import type { CustomerRow, CustomerInsights, CouponCandidate, CouponReasonUI } from "./_types";

/** Roda `fn` no contexto de tenant e entrega tenantId + config de cupom. */
async function tx<T>(
  fn: (ctx: { tid: string; cupomDiasRisco: number; cupomAutomatico: boolean }) => Promise<T>,
): Promise<T> {
  const ctx = await requireActiveTenant();
  return runWithTenant(ctx.tenant.id, () =>
    fn({
      tid: ctx.tenant.id,
      cupomDiasRisco: ctx.tenant.cupomDiasRisco,
      cupomAutomatico: ctx.tenant.cupomAutomatico,
    }),
  );
}

const ok = () => revalidatePath("/clientes");

// ── Cadastro ────────────────────────────────────────────────

const customerSchema = z.object({
  nome: z.string().trim().min(2, "Informe o nome do cliente."),
  cpf: z.string().optional().nullable(),
  dataNascimento: z.string().optional().nullable(), // dd/mm/aaaa
  sexo: z.enum(["MASCULINO", "FEMININO", "OUTRO"]).optional().nullable(),
  whatsapp: z.string().optional().nullable(),
});

/** dd/mm/aaaa → Date (UTC, sem hora). null se vazio/ inválido. */
function parseData(s?: string | null): Date | null {
  const d = onlyDigits(s ?? "");
  if (d.length !== 8) return null;
  const dia = Number(d.slice(0, 2));
  const mes = Number(d.slice(2, 4));
  const ano = Number(d.slice(4, 8));
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12 || ano < 1900) return null;
  const dt = new Date(Date.UTC(ano, mes - 1, dia));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function customerData(d: z.infer<typeof customerSchema>) {
  return {
    nome: d.nome.trim(),
    cpf: d.cpf ? onlyDigits(d.cpf) || null : null,
    dataNascimento: parseData(d.dataNascimento),
    sexo: d.sexo ?? null,
    whatsapp: d.whatsapp ? onlyDigits(d.whatsapp) || null : null,
  };
}

export async function createCustomer(input: z.input<typeof customerSchema>) {
  return tx(async ({ tid }) => {
    const d = customerSchema.parse(input);
    const data = customerData(d);
    if (data.cpf) {
      const dup = await db.customer.findFirst({ where: { cpf: data.cpf } });
      if (dup) throw new Error(`Já existe um cliente com esse CPF: «${dup.nome}».`);
    }
    const c = await db.customer.create({ data: { tenantId: tid, ...data } });
    ok();
    return c.id;
  });
}

export async function updateCustomer(id: string, input: z.input<typeof customerSchema>) {
  return tx(async () => {
    const d = customerSchema.parse(input);
    const data = customerData(d);
    if (data.cpf) {
      const dup = await db.customer.findFirst({ where: { cpf: data.cpf, id: { not: id } } });
      if (dup) throw new Error(`Já existe um cliente com esse CPF: «${dup.nome}».`);
    }
    await db.customer.update({ where: { id }, data });
    ok();
  });
}

export async function setCustomerActive(id: string, ativo: boolean) {
  return tx(async () => {
    await db.customer.update({ where: { id }, data: { ativo } });
    ok();
  });
}

// ── Leitura ─────────────────────────────────────────────────

export async function searchCustomers(queryRaw: string): Promise<CustomerRow[]> {
  const term = queryRaw.trim();
  if (term.length < 2) return [];
  return tx(async () => {
    const rows = await loadCustomerRows();
    const dig = onlyDigits(term);
    const q = term.toLowerCase();
    return rows
      .filter(
        (c) =>
          c.nome.toLowerCase().includes(q) ||
          (dig.length >= 3 && ((c.cpf ?? "").includes(dig) || (c.whatsapp ?? "").includes(dig))),
      )
      .slice(0, 8);
  });
}

export async function getCustomerInsights(customerId: string): Promise<CustomerInsights> {
  return tx(() => computeInsights(customerId));
}

export async function getCouponCandidates(): Promise<CouponCandidate[]> {
  return tx(({ cupomDiasRisco }) => loadCouponCandidates(cupomDiasRisco));
}

// ── Cupom (WhatsApp) ────────────────────────────────────────

const MENSAGEM: Record<CouponReasonUI, (nome: string) => string> = {
  RISCO: (nome) =>
    `Oi, ${nome}! Sentimos sua falta 💙 Volte e ganhe 10% de desconto na próxima compra. Cupom: VOLTA10`,
  ANIVERSARIO: (nome) =>
    `Feliz aniversário, ${nome}! 🎂 Comemore com a gente: 15% de desconto no seu presente. Cupom: NIVER15`,
};

/**
 * Registra e "envia" um cupom pelo WhatsApp. Sem gateway de mensageria
 * configurado, devolvemos o link wa.me (com a mensagem pronta) para o operador
 * abrir a conversa — e persistimos o disparo em CouponSend (histórico + trava).
 */
export async function sendCoupon(
  customerId: string,
  tipo: CouponReasonUI,
  automatico = false,
): Promise<{ waLink: string | null }> {
  return tx(async ({ tid }) => {
    const c = await db.customer.findFirst({ where: { id: customerId } });
    if (!c) throw new Error("Cliente não encontrado.");
    const mensagem = MENSAGEM[tipo](c.nome.split(" ")[0]);

    await db.couponSend.create({
      data: { tenantId: tid, customerId, motivo: tipo, automatico, mensagem },
    });
    ok();

    if (!c.whatsapp) return { waLink: null };
    const numero = c.whatsapp.length <= 11 ? `55${c.whatsapp}` : c.whatsapp;
    return { waLink: `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}` };
  });
}

// ── Configuração de fidelização ─────────────────────────────

const cupomConfigSchema = z.object({
  cupomAutomatico: z.boolean(),
  cupomDiasRisco: z.number().int().min(1).max(365),
});

export async function updateCupomConfig(input: z.input<typeof cupomConfigSchema>) {
  return tx(async ({ tid }) => {
    const d = cupomConfigSchema.parse(input);
    await db.tenant.update({ where: { id: tid }, data: d });
    revalidatePath("/clientes");
    revalidatePath("/configuracoes", "layout");
  });
}
