import Link from "next/link";
import { redirect } from "next/navigation";
import { withTenant } from "@/lib/current-tenant";
import { requirePermissao } from "@/lib/guard";
import { listSites, getActiveSiteId } from "@/lib/sites";
import { EstoqueHeader } from "./_header";

export default async function EstoqueLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePermissao("estoque.ver");
  const [sites, activeSiteId] = await withTenant(ctx, async () => {
    const [s, id] = await Promise.all([listSites(), getActiveSiteId()]);
    return [s, id] as const;
  });

  const multiSite = sites.length > 1;

  return (
    <div className="flex flex-col gap-5">
      <EstoqueHeader
        sites={sites}
        activeSiteId={activeSiteId}
        multiSite={multiSite}
        topologia={ctx.tenant.topologia ?? "LOCAL"}
        empresa={ctx.tenant.nome}
      />
      {children}
    </div>
  );
}
