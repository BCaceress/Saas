import "server-only";
import bcrypt from "bcryptjs";
import { basePrisma } from "./prisma";
import { seedTenant } from "./seed-tenant";

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

    const subdomain = await uniqueSubdomain(tx, name || email.split("@")[0]);

    const tenant = await tx.tenant.create({
      data: {
        subdomain,
        nome: name ? `Mercado de ${name.split(" ")[0]}` : "Meu mercado",
        status: "TRIAL",
        trialEndsAt,
      },
    });

    await tx.membership.create({
      data: { userId: user.id, tenantId: tenant.id, role: "OWNER" },
    });

    await seedTenant(tx, tenant.id);

    return { userId: user.id, tenantId: tenant.id, subdomain };
  });
}

export class SignupError extends Error {
  constructor(message: string, readonly code: "EMAIL_TAKEN") {
    super(message);
  }
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
    const subdomain = await uniqueSubdomain(tx, base);
    const tenant = await tx.tenant.create({
      data: {
        subdomain,
        nome: input.name ? `Mercado de ${input.name.split(" ")[0]}` : "Meu mercado",
        status: "TRIAL",
        trialEndsAt,
      },
    });
    await tx.membership.create({
      data: { userId: input.userId, tenantId: tenant.id, role: "OWNER" },
    });
    await seedTenant(tx, tenant.id);
  });
}
