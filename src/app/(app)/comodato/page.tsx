import { redirect } from "next/navigation";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import {
  loadAssetRows,
  loadContainerTypes,
  loadContainerBalances,
  loadCustomerOptions,
} from "./_data";
import { ComodatoClient } from "./_client";

export const metadata = { title: "Comodato — NoHub Market" };

export default async function ComodatoPage() {
  const ctx = await requireActiveTenant();
  if (!ctx.tenant.moduloComodato) redirect("/inicio");

  const [assets, containerTypes, balances, customers] = await runWithTenant(
    ctx.tenant.id,
    () =>
      Promise.all([
        loadAssetRows(),
        loadContainerTypes(),
        loadContainerBalances(),
        loadCustomerOptions(),
      ]),
  );

  return (
    <ComodatoClient
      assets={assets}
      containerTypes={containerTypes}
      balances={balances}
      customers={customers}
    />
  );
}
