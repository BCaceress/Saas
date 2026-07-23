import { MonitorSmartphone } from "lucide-react";
import { requireActiveTenant } from "@/lib/current-tenant";
import { featureAtiva } from "@/lib/planos";
import { PageHeader } from "@/components/app/page-header";
import { AutoatendimentoConfigClient } from "./_client";

export const metadata = { title: "Autoatendimento — NoHub Market" };

export default async function AutoatendimentoConfigPage() {
  const { tenant } = await requireActiveTenant();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Autoatendimento"
        icon={MonitorSmartphone}
        description="Modo quiosque do totem: PIN de saída e acesso à tela."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <AutoatendimentoConfigClient
        temPin={!!tenant.totemPinHash}
        moduloAtivo={featureAtiva(tenant, "autoatendimento")}
      />
    </div>
  );
}
