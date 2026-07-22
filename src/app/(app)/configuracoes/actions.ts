"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { db, basePrisma, comTenant } from "@/lib/prisma";
import { requireActiveTenant, type ActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { onlyDigits } from "@/lib/normalize";
import { acessosSchema, isAdmin, type Acesso } from "@/lib/permissoes";
import { novoToken, conviteExpiraEm, conviteUrl } from "@/lib/convites";

// ============================================================
// Actions das telas de Configurações. Tenant/Membership/Invite são tabelas de
// CONTROLE (como no provisionamento): Membership/Invite usam basePrisma com
// tenantId explícito; Tenant é atualizado via db pelo próprio id.
// ============================================================

/** Exige perfil ADMINISTRADOR e entrega o contexto. */
async function requireGestor(): Promise<ActiveTenant> {
  const ctx = await requireActiveTenant();
  if (!isAdmin(ctx.acessos)) {
    throw new Error("Apenas um administrador pode alterar as configurações.");
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
  logoUrl: z.string().trim().optional().nullable(),
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
    // Logo: data URL (upload redimensionado no client) ou URL http(s) legada.
    const logoUrl = d.logoUrl?.trim() ?? "";
    if (logoUrl && !/^(data:image\/(png|jpeg|webp|svg\+xml);base64,|https?:\/\/)/.test(logoUrl)) {
      throw new Error("Logo inválida — envie a imagem novamente.");
    }
    if (logoUrl.length > 700_000) {
      throw new Error("Logo muito grande — envie uma imagem menor.");
    }

    await db.tenant.update({
      where: { id: tenant.id },
      data: {
        nome: d.nome.trim(),
        logoUrl: logoUrl || null,
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
  moduloAutoatendimento: z.boolean(),
});

export async function updateModulos(input: z.input<typeof modulosSchema>) {
  return txGestor(async ({ tenant }) => {
    const d = modulosSchema.parse(input);
    await db.tenant.update({ where: { id: tenant.id }, data: d });
    // Toggles mudam o menu (sidebar) — revalida o shell inteiro.
    revalidatePath("/", "layout");
  });
}

// ── Autoatendimento (totem) ─────────────────────────────────

const totemPinSchema = z.object({
  // null limpa o PIN (saída livre do quiosque).
  pin: z.string().regex(/^\d{4,6}$/, "PIN de 4 a 6 dígitos.").nullable(),
});

export async function updateTotemPin(input: z.input<typeof totemPinSchema>) {
  return txGestor(async ({ tenant }) => {
    const d = totemPinSchema.parse(input);
    const totemPinHash = d.pin ? await bcrypt.hash(d.pin, 10) : null;
    await db.tenant.update({ where: { id: tenant.id }, data: { totemPinHash } });
    ok();
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
  acessos: acessosSchema,
});

/**
 * Confere que toda loja citada existe neste tenant. Sem isso um siteId de outro
 * tenant vindo do client viraria acesso válido.
 */
async function validarSites(tenantId: string, acessos: Acesso[]) {
  const ids = [...new Set(acessos.map((a) => a.siteId).filter((s): s is string => !!s))];
  if (ids.length === 0) return;
  const achados = await comTenant(
    tenantId,
    basePrisma.site.count({ where: { id: { in: ids }, tenantId } }),
  );
  if (achados !== ids.length) throw new Error("Loja inválida na lista de acessos.");
}

/**
 * Convida por e-mail. Se o usuário já existe, vira membro na hora; senão fica
 * um convite pendente, consumido quando ele se cadastrar com esse e-mail.
 */
export async function inviteMember(input: z.input<typeof inviteSchema>) {
  const ctx = await requireGestor();
  const d = inviteSchema.parse(input);
  await validarSites(ctx.tenant.id, d.acessos);

  const user = await basePrisma.user.findUnique({ where: { email: d.email } });
  if (user) {
    const existing = await basePrisma.membership.findUnique({
      where: { userId_tenantId: { userId: user.id, tenantId: ctx.tenant.id } },
    });
    if (existing) throw new Error("Essa pessoa já faz parte da equipe.");
    await basePrisma.membership.create({
      data: {
        userId: user.id,
        tenantId: ctx.tenant.id,
        acessos: {
          create: d.acessos.map((a) => ({
            tenantId: ctx.tenant.id,
            perfil: a.perfil,
            siteId: a.siteId,
          })),
        },
      },
    });
    okEquipe();
    return { status: "member" as const };
  }

  // Reconvidar o mesmo e-mail troca o token: o link antigo morre na hora.
  const inv = await basePrisma.invite.upsert({
    where: { tenantId_email: { tenantId: ctx.tenant.id, email: d.email } },
    create: {
      tenantId: ctx.tenant.id,
      email: d.email,
      acessos: d.acessos,
      token: novoToken(),
      expiresAt: conviteExpiraEm(),
      criadoPorId: ctx.user.id,
    },
    update: {
      acessos: d.acessos,
      token: novoToken(),
      expiresAt: conviteExpiraEm(),
      criadoPorId: ctx.user.id,
    },
  });
  okEquipe();
  return { status: "invited" as const, link: conviteUrl(inv.token) };
}

export async function revokeInvite(inviteId: string) {
  const ctx = await requireGestor();
  await basePrisma.invite.deleteMany({
    where: { id: inviteId, tenantId: ctx.tenant.id },
  });
  okEquipe();
}

/** Gera um link novo e reinicia a validade. Invalida o link anterior. */
export async function renovarConvite(inviteId: string): Promise<string> {
  const ctx = await requireGestor();
  const inv = await basePrisma.invite.findFirst({
    where: { id: inviteId, tenantId: ctx.tenant.id },
  });
  if (!inv) throw new Error("Convite não encontrado.");

  const atualizado = await basePrisma.invite.update({
    where: { id: inv.id },
    data: { token: novoToken(), expiresAt: conviteExpiraEm(), criadoPorId: ctx.user.id },
  });
  okEquipe();
  return conviteUrl(atualizado.token);
}

/** Substitui a lista inteira de acessos de um membro (perfis × lojas). */
export async function updateMemberAcessos(
  membershipId: string,
  acessos: z.input<typeof acessosSchema>,
) {
  const ctx = await requireGestor();
  const lista = acessosSchema.parse(acessos);
  await validarSites(ctx.tenant.id, lista);

  const m = await basePrisma.membership.findFirst({
    where: { id: membershipId, tenantId: ctx.tenant.id },
  });
  if (!m) throw new Error("Membro não encontrado.");
  if (m.proprietario && !lista.some((a) => a.perfil === "ADMINISTRADOR")) {
    throw new Error("O dono da conta precisa continuar como administrador.");
  }
  if (m.userId === ctx.user.id && !lista.some((a) => a.perfil === "ADMINISTRADOR")) {
    throw new Error("Você não pode tirar o próprio acesso de administrador.");
  }
  await garantirOutroAdmin(ctx.tenant.id, m.id, lista.some((a) => a.perfil === "ADMINISTRADOR"));

  await basePrisma.$transaction([
    basePrisma.membershipAccess.deleteMany({ where: { membershipId: m.id } }),
    basePrisma.membershipAccess.createMany({
      data: lista.map((a) => ({
        tenantId: ctx.tenant.id,
        membershipId: m.id,
        perfil: a.perfil,
        siteId: a.siteId,
      })),
    }),
  ]);
  okEquipe();
}

/** Bloqueia o login sem apagar o histórico da pessoa. */
export async function setMemberAtivo(membershipId: string, ativo: boolean) {
  const ctx = await requireGestor();
  const m = await basePrisma.membership.findFirst({
    where: { id: membershipId, tenantId: ctx.tenant.id },
  });
  if (!m) throw new Error("Membro não encontrado.");
  if (m.userId === ctx.user.id) throw new Error("Você não pode desativar a si mesmo.");
  if (m.proprietario) throw new Error("O dono da conta não pode ser desativado.");
  if (!ativo) await garantirOutroAdmin(ctx.tenant.id, m.id, false);

  await basePrisma.membership.update({ where: { id: m.id }, data: { ativo } });
  okEquipe();
}

export async function removeMember(membershipId: string) {
  const ctx = await requireGestor();
  const m = await basePrisma.membership.findFirst({
    where: { id: membershipId, tenantId: ctx.tenant.id },
  });
  if (!m) throw new Error("Membro não encontrado.");
  if (m.userId === ctx.user.id) throw new Error("Você não pode remover a si mesmo.");
  if (m.proprietario) throw new Error("O dono da conta não pode ser removido.");
  await garantirOutroAdmin(ctx.tenant.id, m.id, false);

  await basePrisma.membership.delete({ where: { id: m.id } });
  okEquipe();
}

/**
 * Impede a conta ficar sem administrador ativo. `continuaAdmin` = se o próprio
 * membro alvo seguirá administrador depois da mudança.
 */
async function garantirOutroAdmin(
  tenantId: string,
  membershipId: string,
  continuaAdmin: boolean,
) {
  if (continuaAdmin) return;
  const outros = await basePrisma.membership.count({
    where: {
      tenantId,
      ativo: true,
      id: { not: membershipId },
      acessos: { some: { perfil: "ADMINISTRADOR" } },
    },
  });
  if (outros === 0) {
    throw new Error("A conta precisa de pelo menos um administrador ativo.");
  }
}
