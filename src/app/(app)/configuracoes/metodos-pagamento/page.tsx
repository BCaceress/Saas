import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { listSites } from "@/lib/sites";
import { CreditCard } from "lucide-react";
import { listSitePaymentMethods } from "@/lib/vendas";
import { getConfigPagamento } from "@/lib/pagamentos";
import { db } from "@/lib/prisma";
import { PageHeader } from "@/components/app/page-header";
import { MetodosPagamentoClient } from "./_client";
import type { PaymentMethod } from "@/generated/prisma";

const TODOS: PaymentMethod[] = ["DINHEIRO", "CARTAO_CREDITO", "CARTAO_DEBITO", "PIX", "OUTRO"];

export default async function MetodosPagamentoPage() {
  const ctx = await requireActiveTenant();

  return runWithTenant(ctx.tenant.id, async () => {
    const sites = await listSites();
    const [config, terminaisRaw] = await Promise.all([
      getConfigPagamento(ctx.tenant.id),
      db.paymentTerminal.findMany({
        where: { ativo: true },
        select: { id: true, nome: true, externalId: true, siteId: true },
        orderBy: { nome: "asc" },
      }),
    ]);
    const siteNome = new Map(sites.map((s) => [s.id, s.nome]));
    const terminais = terminaisRaw.map((t) => ({
      ...t,
      siteNome: siteNome.get(t.siteId) ?? "—",
    }));
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
          title="Métodos de pagamento"
          icon={CreditCard}
          description="Configure como sua loja recebe pagamentos no PDV e no autoatendimento."
          backHref="/configuracoes"
          innerClassName="max-w-none"
        />
        <MetodosPagamentoClient
          porSite={porSite}
          config={config}
          terminais={terminais}
          sites={sites.map((s) => ({ id: s.id, nome: s.nome }))}
        />
      </div>
    );
  });
}
