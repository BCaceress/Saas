import { Wallet } from "lucide-react";
import { requireActiveTenant } from "@/lib/current-tenant";
import { PageHeader } from "@/components/app/page-header";
import { CaixaConfigClient } from "./_client";

export const metadata = { title: "Caixa — NoHub Market" };

export default async function CaixaConfigPage() {
  const { tenant } = await requireActiveTenant();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Caixa"
        icon={Wallet}
        description="Regras do caixa do PDV: fundo de troco e limite de dinheiro na gaveta."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <CaixaConfigClient
        moduloPdv={tenant.moduloPdv}
        initial={{
          caixaFundoTroco:
            tenant.caixaFundoTroco != null ? Number(tenant.caixaFundoTroco) : null,
          caixaLimiteGaveta:
            tenant.caixaLimiteGaveta != null ? Number(tenant.caixaLimiteGaveta) : null,
        }}
      />
    </div>
  );
}
