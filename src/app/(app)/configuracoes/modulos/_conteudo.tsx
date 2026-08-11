import { requireActiveTenant } from "@/lib/current-tenant";
import {
  temFeature,
  FEATURE_TOGGLE,
  FEATURES_COM_TOGGLE,
  mensagemUpgrade,
  type FeatureComToggle,
} from "@/lib/planos";
import { ModulosClient } from "./_client";

/** Miolo dos módulos — compartilhado pelo desktop e pelo `/m`. */
export async function ConteudoModulos() {
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
  );
}
