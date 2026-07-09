import { Warehouse } from "lucide-react";
import { requireActiveTenant } from "@/lib/current-tenant";
import { PageHeader } from "@/components/app/page-header";
import { EstoqueConfigClient } from "./_client";

export const metadata = { title: "Estoque e alertas — NoHub Market" };

export default async function EstoqueConfigPage() {
  const { tenant } = await requireActiveTenant();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Estoque e alertas"
        icon={Warehouse}
        description="Padrões de estoque e quando o sistema deve chamar sua atenção."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <EstoqueConfigClient
        initial={{
          estoqueMinimoPadrao: tenant.estoqueMinimoPadrao,
          produtoParadoDias: tenant.produtoParadoDias,
          recebimentoExigeContagem: tenant.recebimentoExigeContagem,
        }}
        multiPonto={(tenant.numPontos ?? 1) > 1}
      />
    </div>
  );
}
