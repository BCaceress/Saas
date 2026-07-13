import { Gift } from "lucide-react";
import { requireActiveTenant } from "@/lib/current-tenant";
import { PageHeader } from "@/components/app/page-header";
import { FidelizacaoClient } from "./_client";

export const metadata = { title: "Fidelização — NoHub Market" };

export default async function FidelizacaoPage() {
  const ctx = await requireActiveTenant();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Fidelização"
        icon={Gift}
        description="Defina como os cupons de retorno e aniversário são enviados aos clientes."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <FidelizacaoClient
        cupomAutomatico={ctx.tenant.cupomAutomatico}
        cupomDiasRisco={ctx.tenant.cupomDiasRisco}
        tierBronzeMin={ctx.tenant.tierBronzeMin}
        tierPrataMin={ctx.tenant.tierPrataMin}
        tierOuroMin={ctx.tenant.tierOuroMin}
        tierDiamanteMin={ctx.tenant.tierDiamanteMin}
      />
    </div>
  );
}
