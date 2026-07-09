import { Blocks } from "lucide-react";
import { requireActiveTenant } from "@/lib/current-tenant";
import { PageHeader } from "@/components/app/page-header";
import { ModulosClient } from "./_client";

export const metadata = { title: "Módulos — NoHub Market" };

export default async function ModulosPage() {
  const { tenant } = await requireActiveTenant();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Módulos"
        icon={Blocks}
        description="Ligue e desligue os módulos da sua operação — o menu se adapta na hora."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <ModulosClient
        initial={{
          moduloPdv: tenant.moduloPdv,
          moduloFiscal: tenant.moduloFiscal,
          moduloComodato: tenant.moduloComodato,
          moduloRota: tenant.moduloRota,
        }}
      />
    </div>
  );
}
