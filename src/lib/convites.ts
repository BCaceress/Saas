import "server-only";
import { randomBytes } from "node:crypto";
import { basePrisma } from "./prisma";
import { parseAcessosJson } from "./permissoes";
import { rootUrl } from "./urls";

// ============================================================
// Convite de equipe. O link (/convite/<token>) vive no domínio RAIZ — é onde
// moram as telas de auth; o subdomínio do tenant redireciona /login e /cadastro
// para lá. Invite é tabela de CONTROLE: sempre basePrisma, tenantId explícito.
// ============================================================

export const CONVITE_VALIDADE_DIAS = 7;

/** Segredo do link. 24 bytes = 32 chars base64url, o bastante contra chute. */
export function novoToken(): string {
  return randomBytes(24).toString("base64url");
}

export function conviteExpiraEm(): Date {
  return new Date(Date.now() + CONVITE_VALIDADE_DIAS * 24 * 60 * 60 * 1000);
}

export function conviteUrl(token: string): string {
  return rootUrl(`/convite/${token}`);
}

type Tx = Parameters<Parameters<typeof basePrisma.$transaction>[0]>[0];

type ConviteBase = { id: string; tenantId: string; acessos: unknown };

/**
 * Cria a Membership com os acessos do convite. Lojas que sumiram entre o
 * convite e o aceite são descartadas — jamais promovidas para global, que daria
 * acesso a mais do que foi convidado.
 */
export async function criarMembershipDoConvite(
  tx: Tx,
  userId: string,
  invite: ConviteBase,
): Promise<void> {
  const acessos = parseAcessosJson(invite.acessos);
  const siteIds = acessos.map((a) => a.siteId).filter((s): s is string => s !== null);
  const existentes = new Set(
    siteIds.length
      ? (
          await tx.site.findMany({
            where: { id: { in: siteIds }, tenantId: invite.tenantId },
            select: { id: true },
          })
        ).map((s) => s.id)
      : [],
  );

  await tx.membership.create({
    data: {
      userId,
      tenantId: invite.tenantId,
      acessos: {
        create: acessos
          .filter((a) => a.siteId === null || existentes.has(a.siteId))
          .map((a) => ({ tenantId: invite.tenantId, perfil: a.perfil, siteId: a.siteId })),
      },
    },
  });
}

export type ConviteResolvido =
  | { estado: "invalido" }
  | { estado: "expirado"; tenantNome: string }
  | {
      estado: "valido";
      id: string;
      tenantId: string;
      tenantNome: string;
      subdomain: string;
      email: string;
      acessos: ReturnType<typeof parseAcessosJson>;
      convidadoPor: string | null;
    };

/** Lê o convite pelo token do link. Não exige sessão. */
export async function resolverConvite(token: string): Promise<ConviteResolvido> {
  const inv = await basePrisma.invite.findUnique({
    where: { token },
    include: { tenant: { select: { nome: true, subdomain: true } } },
  });
  if (!inv) return { estado: "invalido" };
  if (inv.expiresAt.getTime() < Date.now()) {
    return { estado: "expirado", tenantNome: inv.tenant.nome };
  }

  const autor = inv.criadoPorId
    ? await basePrisma.user.findUnique({
        where: { id: inv.criadoPorId },
        select: { name: true, email: true },
      })
    : null;

  return {
    estado: "valido",
    id: inv.id,
    tenantId: inv.tenantId,
    tenantNome: inv.tenant.nome,
    subdomain: inv.tenant.subdomain,
    email: inv.email,
    acessos: parseAcessosJson(inv.acessos),
    convidadoPor: autor?.name ?? autor?.email ?? null,
  };
}
