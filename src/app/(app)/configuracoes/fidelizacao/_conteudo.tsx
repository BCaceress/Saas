import { requireActiveTenant } from "@/lib/current-tenant";
import { FidelizacaoClient } from "./_client";

/** Miolo da fidelização — compartilhado pelo desktop e pelo `/m`. */
export async function ConteudoFidelizacao() {
  const { tenant } = await requireActiveTenant();
  return (
    <FidelizacaoClient
      cupomAutomatico={tenant.cupomAutomatico}
      cupomDiasRisco={tenant.cupomDiasRisco}
      tierBronzeMin={tenant.tierBronzeMin}
      tierPrataMin={tenant.tierPrataMin}
      tierOuroMin={tenant.tierOuroMin}
      tierDiamanteMin={tenant.tierDiamanteMin}
    />
  );
}
