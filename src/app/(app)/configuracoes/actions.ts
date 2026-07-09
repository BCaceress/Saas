"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db, basePrisma } from "@/lib/prisma";
import { requireActiveTenant, type ActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { onlyDigits } from "@/lib/normalize";

// ============================================================
// Actions das telas de Configurações. Tenant/Membership/Invite são tabelas de
// CONTROLE (como no provisionamento): Membership/Invite usam basePrisma com
// tenantId explícito; Tenant é atualizado via db pelo próprio id.
// ============================================================

/** Exige papel de gestão (OWNER/ADMIN) e entrega o contexto. */
async function requireGestor(): Promise<ActiveTenant> {
  const ctx = await requireActiveTenant();
  if (ctx.role !== "OWNER" && ctx.role !== "ADMIN") {
    throw new Error("Apenas o proprietário ou um administrador pode alterar as configurações.");
  }
  return ctx;
}

/** Roda `fn` no contexto de tenant, já com papel de gestão validado. */
async function txGestor<T>(fn: (ctx: ActiveTenant) => Promise<T>): Promise<T> {
  const ctx = await requireGestor();
  return runWithTenant(ctx.tenant.id, () => fn(ctx));
}

const ok = () => revalidatePath("/configuracoes", "layout");

// ── Empresa ─────────────────────────────────────────────────

const empresaSchema = z.object({
  nome: z.string().trim().min(2, "Informe o nome do mercado."),
  razaoSocial: z.string().trim().optional().nullable(),
  cnpj: z.string().optional().nullable(),
  telefone: z.string().optional().nullable(),
  emailContato: z.string().trim().optional().nullable(),
  cep: z.string().optional().nullable(),
  rua: z.string().trim().optional().nullable(),
  numero: z.string().trim().optional().nullable(),
  cidade: z.string().trim().optional().nullable(),
  estado: z.string().trim().optional().nullable(),
});

export async function updateEmpresa(input: z.input<typeof empresaSchema>) {
  return txGestor(async ({ tenant }) => {
    const d = empresaSchema.parse(input);
    const cnpj = d.cnpj ? onlyDigits(d.cnpj) : "";
    if (cnpj && cnpj.length !== 14) throw new Error("CNPJ incompleto — confira os 14 dígitos.");
    const email = d.emailContato?.trim() ?? "";
    if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error("E-mail de contato inválido.");

    await db.tenant.update({
      where: { id: tenant.id },
      data: {
        nome: d.nome.trim(),
        razaoSocial: d.razaoSocial?.trim() || null,
        cnpj: cnpj || null,
        telefone: d.telefone ? onlyDigits(d.telefone) || null : null,
        emailContato: email || null,
        cep: d.cep ? onlyDigits(d.cep) || null : null,
        rua: d.rua?.trim() || null,
        numero: d.numero?.trim() || null,
        cidade: d.cidade?.trim() || null,
        estado: d.estado?.trim().toUpperCase().slice(0, 2) || null,
      },
    });
    ok();
  });
}

// ── Módulos ─────────────────────────────────────────────────

const modulosSchema = z.object({
  moduloPdv: z.boolean(),
  moduloFiscal: z.boolean(),
  moduloComodato: z.boolean(),
  moduloRota: z.boolean(),
});

export async function updateModulos(input: z.input<typeof modulosSchema>) {
  return txGestor(async ({ tenant }) => {
    const d = modulosSchema.parse(input);
    await db.tenant.update({ where: { id: tenant.id }, data: d });
    // Toggles mudam o menu (sidebar) — revalida o shell inteiro.
    revalidatePath("/", "layout");
  });
}

// ── Estoque e alertas ───────────────────────────────────────

const estoqueConfigSchema = z.object({
  estoqueMinimoPadrao: z.number().int().min(0).max(9999),
  produtoParadoDias: z.number().int().min(7).max(365),
  recebimentoExigeContagem: z.boolean(),
});

export async function updateEstoqueConfig(input: z.input<typeof estoqueConfigSchema>) {
  return txGestor(async ({ tenant }) => {
    const d = estoqueConfigSchema.parse(input);
    await db.tenant.update({ where: { id: tenant.id }, data: d });
    ok();
  });
}

// ── Caixa / PDV ─────────────────────────────────────────────

const caixaConfigSchema = z.object({
  caixaFundoTroco: z.number().min(0).max(99_999).nullable(),
  caixaLimiteGaveta: z.number().min(0).max(999_999).nullable(),
});

export async function updateCaixaConfig(input: z.input<typeof caixaConfigSchema>) {
  return txGestor(async ({ tenant }) => {
    const d = caixaConfigSchema.parse(input);
    await db.tenant.update({
      where: { id: tenant.id },
      data: {
        caixaFundoTroco: d.caixaFundoTroco,
        caixaLimiteGaveta: d.caixaLimiteGaveta,
      },
    });
    revalidatePath("/", "layout"); // navbar/PDV leem esses valores
  });
}

// ── Notificações (sino) ─────────────────────────────────────

const ALERT_CATEGORIES = [
  "criticos",
  "operacao",
  "consumo",
  "financeiro",
  "inventario",
  "inteligencia",
] as const;

const notifSchema = z.object({
  alertasDesativados: z.array(z.enum(ALERT_CATEGORIES)).max(ALERT_CATEGORIES.length),
});

export async function updateNotificacoes(input: z.input<typeof notifSchema>) {
  return txGestor(async ({ tenant }) => {
    const d = notifSchema.parse(input);
    await db.tenant.update({
      where: { id: tenant.id },
      data: { alertasDesativados: [...new Set(d.alertasDesativados)] },
    });
    ok();
  });
}

// ── Equipe: membros e convites ──────────────────────────────

const okEquipe = () => revalidatePath("/configuracoes/usuarios");

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  role: z.enum(["ADMIN", "MEMBER"]),
});

/**
 * Convida por e-mail. Se o usuário já existe, vira membro na hora; senão fica
 * um convite pendente, consumido quando ele se cadastrar com esse e-mail.
 */
export async function inviteMember(input: z.input<typeof inviteSchema>) {
  const ctx = await requireGestor();
  const d = inviteSchema.parse(input);
  if (d.role === "ADMIN" && ctx.role !== "OWNER") {
    throw new Error("Apenas o proprietário pode convidar administradores.");
  }

  const user = await basePrisma.user.findUnique({ where: { email: d.email } });
  if (user) {
    const existing = await basePrisma.membership.findUnique({
      where: { userId_tenantId: { userId: user.id, tenantId: ctx.tenant.id } },
    });
    if (existing) throw new Error("Essa pessoa já faz parte da equipe.");
    await basePrisma.membership.create({
      data: { userId: user.id, tenantId: ctx.tenant.id, role: d.role },
    });
    okEquipe();
    return { status: "member" as const };
  }

  await basePrisma.invite.upsert({
    where: { tenantId_email: { tenantId: ctx.tenant.id, email: d.email } },
    create: { tenantId: ctx.tenant.id, email: d.email, role: d.role },
    update: { role: d.role },
  });
  okEquipe();
  return { status: "invited" as const };
}

export async function revokeInvite(inviteId: string) {
  const ctx = await requireGestor();
  await basePrisma.invite.deleteMany({
    where: { id: inviteId, tenantId: ctx.tenant.id },
  });
  okEquipe();
}

export async function updateMemberRole(membershipId: string, role: "ADMIN" | "MEMBER") {
  const ctx = await requireGestor();
  if (ctx.role !== "OWNER") throw new Error("Apenas o proprietário pode alterar papéis.");

  const m = await basePrisma.membership.findFirst({
    where: { id: membershipId, tenantId: ctx.tenant.id },
  });
  if (!m) throw new Error("Membro não encontrado.");
  if (m.role === "OWNER") throw new Error("O papel do proprietário não pode ser alterado.");

  await basePrisma.membership.update({ where: { id: m.id }, data: { role } });
  okEquipe();
}

export async function removeMember(membershipId: string) {
  const ctx = await requireGestor();
  const m = await basePrisma.membership.findFirst({
    where: { id: membershipId, tenantId: ctx.tenant.id },
  });
  if (!m) throw new Error("Membro não encontrado.");
  if (m.userId === ctx.user.id) throw new Error("Você não pode remover a si mesmo.");
  if (m.role === "OWNER") throw new Error("O proprietário não pode ser removido.");
  if (m.role === "ADMIN" && ctx.role !== "OWNER") {
    throw new Error("Apenas o proprietário pode remover um administrador.");
  }

  await basePrisma.membership.delete({ where: { id: m.id } });
  okEquipe();
}
