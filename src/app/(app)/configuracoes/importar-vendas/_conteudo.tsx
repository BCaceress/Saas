import { requireActiveTenant } from "@/lib/current-tenant";
import { basePrisma, comTenant } from "@/lib/prisma";
import { isAdmin } from "@/lib/permissoes";
import { ImportarVendasClient } from "./_client";

export async function ConteudoImportarVendas() {
  const ctx = await requireActiveTenant();

  const sites = await comTenant(
    ctx.tenant.id,
    basePrisma.site.findMany({
      where: { tenantId: ctx.tenant.id, ativo: true },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
  );

  return <ImportarVendasClient souAdmin={isAdmin(ctx.acessos)} sites={sites} />;
}
