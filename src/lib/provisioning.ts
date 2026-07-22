import "server-only";
import bcrypt from "bcryptjs";
import { basePrisma } from "./prisma";
import { seedTenant } from "./seed-tenant";
import { criarMembershipDoConvite } from "./convites";

const RESERVED = new Set(["www", "app", "api", "admin", "mail", "static", "assets"]);

function slugifyBase(s: string): string {
  const base = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 24);
  return base.length >= 3 ? base : `mercado-${base}`;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

/** Subdomínio único e DNS-safe a partir de uma base, checando no tx. */
async function uniqueSubdomain(
  tx: Parameters<Parameters<typeof basePrisma.$transaction>[0]>[0],
  base: string
): Promise<string> {
  let candidate = slugifyBase(base);
  if (RESERVED.has(candidate)) candidate = `${candidate}-loja`;
  for (let i = 0; i < 20; i++) {
    const taken = await tx.tenant.findUnique({
      where: { subdomain: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
    candidate = `${slugifyBase(base)}-${randomSuffix()}`;
  }
  throw new Error("Não foi possível gerar um subdomínio único.");
}

export type SignupInput = {
  name: string;
  email: string;
  password: string;
};

export type SignupResult = {
  userId: string;
  tenantId: string;
  subdomain: string;
};

/**
 * Cadastro (PRD §5): cria User + Tenant (subdomain) + Membership OWNER e roda o
 * seed do tenant — tudo numa transação. Trial de 14 dias sem cartão.
 * Usa o client cru: o tenant ainda não existe no contexto async.
 */
export async function signupWithTenant(input: SignupInput): Promise<SignupResult> {
  const email = input.email.toLowerCase().trim();
  const name = input.name.trim();

  const existing = await basePrisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new SignupError("E-mail já cadastrado. Faça login.", "EMAIL_TAKEN");
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  return basePrisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name, email, passwordHash },
    });

    // Convite pendente? Entra na equipe que convidou — não cria tenant novo.
    const invited = await acceptInvites(tx, user.id, email);
    if (invited) return { userId: user.id, ...invited };

    const subdomain = await uniqueSubdomain(tx, name || email.split("@")[0]);

    const tenant = await tx.tenant.create({
      data: {
        subdomain,
        nome: name ? `Mercado de ${name.split(" ")[0]}` : "Meu mercado",
        status: "TRIAL",
        trialEndsAt,
      },
    });

    await criarProprietario(tx, user.id, tenant.id);

    await seedTenant(tx, tenant.id);

    return { userId: user.id, tenantId: tenant.id, subdomain };
  });
}

export class SignupError extends Error {
  constructor(message: string, readonly code: "EMAIL_TAKEN") {
    super(message);
  }
}

type Tx = Parameters<Parameters<typeof basePrisma.$transaction>[0]>[0];

/**
 * Dono da conta: Membership com `proprietario` + acesso ADMINISTRADOR global.
 * A flag responde por cobrança e por "não pode ser removido"; o poder de fato
 * vem do acesso.
 */
async function criarProprietario(tx: Tx, userId: string, tenantId: string) {
  await tx.membership.create({
    data: {
      userId,
      tenantId,
      proprietario: true,
      acessos: { create: { tenantId, perfil: "ADMINISTRADOR", siteId: null } },
    },
  });
}

/**
 * Consome convites pendentes do e-mail (Configurações → Usuários): cria uma
 * Membership por convite e apaga os convites. Retorna o tenant do primeiro
 * convite (destino do redirect) ou null se não havia convite.
 */
async function acceptInvites(
  tx: Tx,
  userId: string,
  email: string
): Promise<{ tenantId: string; subdomain: string } | null> {
  // Convite vencido não vale — fica no banco para o admin reenviar.
  const invites = await tx.invite.findMany({
    where: { email, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "asc" },
  });
  if (invites.length === 0) return null;

  for (const inv of invites) {
    await criarMembershipDoConvite(tx, userId, inv);
  }
  await tx.invite.deleteMany({ where: { id: { in: invites.map((i) => i.id) } } });

  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: invites[0].tenantId },
    select: { id: true, subdomain: true },
  });
  return { tenantId: tenant.id, subdomain: tenant.subdomain };
}

/**
 * Provisiona Tenant + Membership + seed para um User já existente (caso OAuth:
 * o adapter cria o User; aqui criamos o resto). Idempotente: se o usuário já
 * tem membership, não faz nada. Chamado no evento createUser do Auth.js.
 */
export async function provisionTenantForUser(input: {
  userId: string;
  name?: string | null;
  email?: string | null;
}): Promise<void> {
  const already = await basePrisma.membership.findFirst({
    where: { userId: input.userId },
    select: { id: true },
  });
  if (already) return;

  const base = (input.name || input.email?.split("@")[0] || "mercado").trim();
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  await basePrisma.$transaction(async (tx) => {
    // Convite pendente (OAuth)? Entra na equipe — não cria tenant novo.
    if (input.email) {
      const invited = await acceptInvites(tx, input.userId, input.email.toLowerCase());
      if (invited) return;
    }

    const subdomain = await uniqueSubdomain(tx, base);
    const tenant = await tx.tenant.create({
      data: {
        subdomain,
        nome: input.name ? `Mercado de ${input.name.split(" ")[0]}` : "Meu mercado",
        status: "TRIAL",
        trialEndsAt,
      },
    });
    await criarProprietario(tx, input.userId, tenant.id);
    await seedTenant(tx, tenant.id);
  });
}
