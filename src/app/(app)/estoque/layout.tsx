import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActiveTenant } from "@/lib/current-tenant";
import { withTenant } from "@/lib/current-tenant";
import { listSites, getActiveSiteId } from "@/lib/sites";
import { EstoqueHeader } from "./_header";

export default async function EstoqueLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireActiveTenant();
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
      />
      {children}
    </div>
  );
}
