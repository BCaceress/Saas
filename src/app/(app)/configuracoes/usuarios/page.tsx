import { UserCog } from "lucide-react";
import { requireActiveTenant } from "@/lib/current-tenant";
import { basePrisma } from "@/lib/prisma";
import { PageHeader } from "@/components/app/page-header";
import { UsuariosClient } from "./_client";

export const metadata = { title: "Usuários — NoHub Market" };

export default async function UsuariosPage() {
  const ctx = await requireActiveTenant();

  // Membership/Invite são tabelas de controle (fora do contexto de tenant) —
  // mesmo padrão do provisionamento: basePrisma com tenantId explícito.
  const [memberships, invites] = await Promise.all([
    basePrisma.membership.findMany({
      where: { tenantId: ctx.tenant.id },
      include: { user: { select: { name: true, email: true, image: true } } },
      orderBy: { createdAt: "asc" },
    }),
    basePrisma.invite.findMany({
      where: { tenantId: ctx.tenant.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Usuários"
        icon={UserCog}
        description="Quem acessa o sistema e o que cada pessoa pode fazer."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <UsuariosClient
        meuUserId={ctx.user.id}
        meuPapel={ctx.role}
        membros={memberships.map((m) => ({
          id: m.id,
          userId: m.userId,
          nome: m.user.name ?? m.user.email ?? "Sem nome",
          email: m.user.email ?? "",
          role: m.role,
          desde: m.createdAt.toISOString(),
        }))}
        convites={invites.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          em: i.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
