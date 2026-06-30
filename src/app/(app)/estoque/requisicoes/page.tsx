import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { loadRequisicoes, loadRequisicaoFormOptions } from "../_data";
import { RequisicoesClient } from "./_client";

export default async function RequisicoesPage() {
  const ctx = await requireActiveTenant();
  const { requisicoes, options, activeSiteId } = await withTenant(ctx, async () => {
    const [requisicoes, options, activeSiteId] = await Promise.all([
      loadRequisicoes(),
      loadRequisicaoFormOptions(),
      getActiveSiteId(),
    ]);
    return { requisicoes, options, activeSiteId };
  });

  if (options.sites.length < 2) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[var(--radius-xl)] border border-line bg-surface py-16 text-center">
        <p className="text-sm font-medium text-muted">
          Requisições exigem ao menos dois sites (um CD e uma loja).
        </p>
        <a href="/configuracoes/sites" className="text-sm text-brand underline">
          Gerenciar sites
        </a>
      </div>
    );
  }

  return (
    <RequisicoesClient
      requisicoes={requisicoes}
      sites={options.sites}
      products={options.products}
      activeSiteId={activeSiteId}
    />
  );
}
