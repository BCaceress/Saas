import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { listSites } from "@/lib/sites";
import { listSitePaymentMethods } from "@/lib/vendas";
import { PageHeader } from "@/components/app/page-header";
import { MetodosClient } from "./_client";
import type { PaymentMethod } from "@/generated/prisma";

const TODOS: PaymentMethod[] = ["DINHEIRO", "CARTAO_CREDITO", "CARTAO_DEBITO", "PIX", "OUTRO"];

export default async function MetodosPagamentoPage() {
  const ctx = await requireActiveTenant();

  return runWithTenant(ctx.tenant.id, async () => {
    const sites = await listSites();
    const porSite = await Promise.all(
      sites.map(async (s) => {
        const metodos = await listSitePaymentMethods(ctx.tenant.id, s.id);
        const ativos = new Map(metodos.map((m) => [m.metodo, m.ativo]));
        return {
          siteId: s.id,
          siteNome: s.nome,
          metodos: TODOS.map((m) => ({ metodo: m, ativo: ativos.get(m) ?? false })),
        };
      }),
    );

    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          eyebrow="Configurações"
          title="Métodos de pagamento"
          description="Defina quais formas de pagamento cada loja aceita no checkout."
          backHref="/configuracoes"
        />
        <MetodosClient porSite={porSite} />
      </div>
    );
  });
}
