import { requireActiveTenant } from "@/lib/current-tenant";
import { featureAtiva } from "@/lib/planos";
import { CaixaConfigClient } from "./_client";

/** Miolo das regras de caixa — compartilhado pelo desktop e pelo `/m`. */
export async function ConteudoCaixa() {
  const { tenant } = await requireActiveTenant();
  return (
    <CaixaConfigClient
      moduloPdv={featureAtiva(tenant, "pdv")}
      initial={{
        caixaFundoTroco:
          tenant.caixaFundoTroco != null ? Number(tenant.caixaFundoTroco) : null,
        caixaLimiteGaveta:
          tenant.caixaLimiteGaveta != null ? Number(tenant.caixaLimiteGaveta) : null,
        controleEstoquePdv: tenant.controleEstoquePdv,
      }}
    />
  );
}
