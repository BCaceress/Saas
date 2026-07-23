import { Blocks } from "lucide-react";
import { requireActiveTenant } from "@/lib/current-tenant";
import { PageHeader } from "@/components/app/page-header";
import {
  temFeature,
  FEATURE_TOGGLE,
  FEATURES_COM_TOGGLE,
  mensagemUpgrade,
  type FeatureComToggle,
} from "@/lib/planos";
import { ModulosClient } from "./_client";

export const metadata = { title: "Módulos — NoHub Market" };

export default async function ModulosPage() {
  const { tenant } = await requireActiveTenant();

  // O que o plano/add-ons liberam. Módulo fora do contrato aparece bloqueado,
  // com o texto do que falta — esconder some com o upsell.
  const bloqueio = Object.fromEntries(
    FEATURES_COM_TOGGLE.map((f) => [
      FEATURE_TOGGLE[f],
      temFeature(tenant, f) ? null : mensagemUpgrade(f),
    ]),
  ) as Record<(typeof FEATURE_TOGGLE)[FeatureComToggle], string | null>;

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
        bloqueio={bloqueio}
        initial={{
          moduloPdv: tenant.moduloPdv,
          moduloFiscal: tenant.moduloFiscal,
          moduloComodato: tenant.moduloComodato,
          moduloRota: tenant.moduloRota,
          moduloAutoatendimento: tenant.moduloAutoatendimento,
        }}
      />
    </div>
  );
}
