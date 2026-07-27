"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertSuperAdmin } from "@/lib/admin";
import { aplicarStatus, precoMensal } from "@/lib/assinatura";
import { logInfo } from "@/lib/log";
import { basePrisma } from "@/lib/prisma";

// ============================================================
// Ações do back-office. Toda ação registra no log com o e-mail de quem fez —
// mexer no plano ou no acesso de um cliente precisa de rastro.
// ============================================================

const ROTA = "/admin";

const planoSchema = z.object({
  tenantId: z.string().min(1),
  plano: z.enum(["PRATA", "OURO", "DIAMANTE"]),
});

export async function adminTrocarPlanoAction(input: z.input<typeof planoSchema>) {
  const quem = await assertSuperAdmin();
  const d = planoSchema.parse(input);

  await basePrisma.tenant.update({ where: { id: d.tenantId }, data: { plano: d.plano } });
  logInfo("admin.plano", { por: quem, tenantId: d.tenantId, plano: d.plano });

  revalidatePath(ROTA);
  return { ok: true as const };
}

const statusSchema = z.object({
  tenantId: z.string().min(1),
  status: z.enum(["TRIAL", "ACTIVE", "SUSPENDED", "CANCELED"]),
});

/**
 * Muda o acesso à mão. Existe para os casos que o gateway não cobre: contrato
 * fechado por boleto, cortesia combinada, cliente encerrando.
 */
export async function adminTrocarStatusAction(input: z.input<typeof statusSchema>) {
  const quem = await assertSuperAdmin();
  const d = statusSchema.parse(input);

  await basePrisma.tenant.update({ where: { id: d.tenantId }, data: { status: d.status } });
  logInfo("admin.status", { por: quem, tenantId: d.tenantId, status: d.status });

  revalidatePath(ROTA);
  return { ok: true as const };
}

const trialSchema = z.object({
  tenantId: z.string().min(1),
  dias: z.coerce.number().int().min(1).max(90),
});

export async function adminEstenderTrialAction(input: z.input<typeof trialSchema>) {
  const quem = await assertSuperAdmin();
  const d = trialSchema.parse(input);

  const tenant = await basePrisma.tenant.findUnique({
    where: { id: d.tenantId },
    select: { trialEndsAt: true },
  });
  if (!tenant) throw new Error("Loja não encontrada.");

  // Estende a partir de HOJE quando o teste já venceu; senão soma ao que resta.
  const base =
    tenant.trialEndsAt && tenant.trialEndsAt > new Date() ? tenant.trialEndsAt : new Date();
  const trialEndsAt = new Date(base.getTime() + d.dias * 24 * 60 * 60 * 1000);

  await basePrisma.tenant.update({
    where: { id: d.tenantId },
    data: { trialEndsAt, status: "TRIAL" },
  });
  logInfo("admin.trial", { por: quem, tenantId: d.tenantId, dias: d.dias });

  revalidatePath(ROTA);
  return { ok: true as const, ate: trialEndsAt.toISOString() };
}

const manualSchema = z.object({
  tenantId: z.string().min(1),
  ativar: z.boolean(),
});

/**
 * Assinatura fora do gateway (boleto, contrato anual, cortesia). Grava
 * `gateway: "manual"` para o job diário não tentar consultar o Mercado Pago
 * atrás de um preapproval que não existe.
 */
export async function adminAssinaturaManualAction(input: z.input<typeof manualSchema>) {
  const quem = await assertSuperAdmin();
  const d = manualSchema.parse(input);

  const tenant = await basePrisma.tenant.findUnique({ where: { id: d.tenantId } });
  if (!tenant) throw new Error("Loja não encontrada.");

  if (!d.ativar) {
    await basePrisma.subscription.updateMany({
      where: { tenantId: d.tenantId, gateway: "manual" },
      data: { status: "CANCELADA", canceladaEm: new Date() },
    });
    logInfo("admin.assinatura-manual", { por: quem, tenantId: d.tenantId, ativar: false });
    revalidatePath(ROTA);
    return { ok: true as const };
  }

  const valor = precoMensal({
    plano: tenant.plano,
    addons: tenant.addons,
    lojasExtras: tenant.lojasExtras,
  });

  await basePrisma.subscription.upsert({
    where: { tenantId: d.tenantId },
    create: {
      tenantId: d.tenantId,
      plano: tenant.plano,
      status: "ATIVA",
      gateway: "manual",
      valorMensal: valor,
      addons: tenant.addons,
    },
    update: {
      plano: tenant.plano,
      status: "ATIVA",
      gateway: "manual",
      externalId: null,
      checkoutUrl: null,
      valorMensal: valor,
      addons: tenant.addons,
      canceladaEm: null,
      inadimplenteDesde: null,
    },
  });

  await aplicarStatus(d.tenantId, "ATIVA");
  logInfo("admin.assinatura-manual", { por: quem, tenantId: d.tenantId, ativar: true, valor });

  revalidatePath(ROTA);
  return { ok: true as const };
}
