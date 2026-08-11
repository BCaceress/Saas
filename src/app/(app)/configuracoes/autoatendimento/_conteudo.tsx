import { requireActiveTenant } from "@/lib/current-tenant";
import { featureAtiva } from "@/lib/planos";
import { AutoatendimentoConfigClient } from "./_client";

/** Miolo do autoatendimento — compartilhado pelo desktop e pelo `/m`. */
export async function ConteudoAutoatendimento() {
  const { tenant } = await requireActiveTenant();
  return (
    <AutoatendimentoConfigClient
      temPin={!!tenant.totemPinHash}
      moduloAtivo={featureAtiva(tenant, "autoatendimento")}
    />
  );
}
