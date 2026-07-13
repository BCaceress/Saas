import { ListChecks } from "lucide-react";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { loadSugestoesReposicao } from "../_data";
import { PageHeader } from "@/components/app/page-header";
import { RevisarClient } from "../_revisar";

// Fluxo focado de revisão: uma página só, sem abas nem wizard — o
// operador rola a lista, ajusta quantidades e o rodapé mostra em
// quantos pedidos a revisão vira.

export default async function RevisarReposicaoPage() {
  const ctx = await requireActiveTenant();
  const data = await withTenant(ctx, async () => {
    const activeSiteId = await getActiveSiteId();
    const sugestoes = await loadSugestoesReposicao(activeSiteId);
    return { sugestoes, activeSiteId };
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Revisar reposição"
        icon={ListChecks}
        backHref="/compras"
        description="Confira as sugestões e ajuste as quantidades antes de criar os pedidos. Os produtos serão agrupados automaticamente por fornecedor."
        innerClassName="max-w-none"
      />
      <RevisarClient grupos={data.sugestoes} siteId={data.activeSiteId} empresa={ctx.tenant.nome} />
    </div>
  );
}
