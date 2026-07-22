import { requireActiveTenant } from "@/lib/current-tenant";
import { basePrisma, comTenant } from "@/lib/prisma";
import { parseAcessosJson, isAdmin } from "@/lib/permissoes";
import { conviteUrl } from "@/lib/convites";
import { UsuariosClient } from "./_client";

export const metadata = { title: "Usuários — NoHub Market" };

export default async function UsuariosPage() {
  const ctx = await requireActiveTenant();

  // Membership/MembershipAccess/Invite são tabelas de controle (fora do contexto
  // de tenant) — mesmo padrão do provisionamento: basePrisma com tenantId explícito.
  const [memberships, invites, sites] = await Promise.all([
    basePrisma.membership.findMany({
      where: { tenantId: ctx.tenant.id },
      include: {
        user: { select: { name: true, email: true, image: true } },
        acessos: { select: { perfil: true, siteId: true } },
      },
      orderBy: [{ proprietario: "desc" }, { createdAt: "asc" }],
    }),
    basePrisma.invite.findMany({
      where: { tenantId: ctx.tenant.id },
      orderBy: { createdAt: "desc" },
    }),
    // Site tem RLS: precisa do tenant setado na mesma conexão (Membership e
    // Invite acima são tabelas de controle, lidas fora de contexto por desenho).
    comTenant(
      ctx.tenant.id,
      basePrisma.site.findMany({
        where: { tenantId: ctx.tenant.id, ativo: true },
        select: { id: true, nome: true, tipo: true },
        orderBy: { nome: "asc" },
      }),
    ),
  ]);

  return (
    <UsuariosClient
      meuUserId={ctx.user.id}
      souAdmin={isAdmin(ctx.acessos)}
      sites={sites}
      membros={memberships.map((m) => ({
        id: m.id,
        userId: m.userId,
        nome: m.user.name ?? m.user.email ?? "Sem nome",
        email: m.user.email ?? "",
        proprietario: m.proprietario,
        ativo: m.ativo,
        acessos: m.acessos,
        ultimoAcesso: m.ultimoAcesso?.toISOString() ?? null,
        desde: m.createdAt.toISOString(),
      }))}
      convites={invites.map((i) => ({
        id: i.id,
        email: i.email,
        acessos: parseAcessosJson(i.acessos),
        link: conviteUrl(i.token),
        expiraEm: i.expiresAt.toISOString(),
        em: i.createdAt.toISOString(),
      }))}
    />
  );
}
