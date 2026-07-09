import { redirect } from "next/navigation";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { getActiveSiteId } from "@/lib/sites";
import { listSitePaymentMethods } from "@/lib/vendas";
import { db } from "@/lib/prisma";
import { loadProdutosVenda } from "@/app/(app)/vendas/_data";
import { TotemKiosk } from "./_kiosk";

export const metadata = { title: "Autoatendimento — NoHub Market" };

export default async function TotemPage() {
  const ctx = await requireActiveTenant();
  // Fora do grupo (app): os guards do shell não valem aqui.
  if (!ctx.tenant.onboardingDone) redirect("/onboarding");
  if (!ctx.tenant.moduloAutoatendimento) redirect("/inicio");

  return runWithTenant(ctx.tenant.id, async () => {
    const siteId = await getActiveSiteId();
    const [produtos, metodos, site] = await Promise.all([
      loadProdutosVenda(siteId),
      siteId ? listSitePaymentMethods(ctx.tenant.id, siteId) : Promise.resolve([]),
      siteId
        ? db.site.findFirst({ where: { id: siteId }, select: { controleIdade: true } })
        : Promise.resolve(null),
    ]);
    const metodosAtivos = metodos.filter((m) => m.ativo).map((m) => m.metodo);

    return (
      <TotemKiosk
        siteId={siteId}
        produtos={produtos}
        metodosAtivos={metodosAtivos}
        tenantNome={ctx.tenant.nome}
        controleIdade={site?.controleIdade ?? false}
        temPin={!!ctx.tenant.totemPinHash}
      />
    );
  });
}
