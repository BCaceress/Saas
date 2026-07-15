import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { loadSaldos } from "./_data";
import { Layers } from "lucide-react";
import { SaldosView } from "./saldos/_client";

export default async function EstoquePage() {
  const ctx = await requireActiveTenant();
  // Opções do form de reposição são carregadas sob demanda no client
  // (fetchEntradaFormDataAction) — a página só precisa dos saldos.
  const [siteId, saldos] = await withTenant(ctx, async () => {
    const sid = await getActiveSiteId();
    return [sid, await loadSaldos(sid)] as const;
  });

  if (saldos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface py-16 text-center">
        <Layers size={36} className="text-faint" />
        <p className="text-sm font-medium text-muted">Nenhum produto com estoque neste site.</p>
        <p className="text-xs text-faint">Registre uma entrada para começar a controlar o estoque.</p>
      </div>
    );
  }

  return <SaldosView saldos={saldos} siteId={siteId} />;
}
