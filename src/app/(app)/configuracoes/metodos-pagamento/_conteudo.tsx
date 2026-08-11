import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { listSites } from "@/lib/sites";
import { listSitePaymentMethods } from "@/lib/vendas";
import { getConfigPagamento } from "@/lib/pagamentos";
import { db } from "@/lib/prisma";
import { MetodosPagamentoClient } from "./_client";
import type { PaymentMethod } from "@/generated/prisma";

const TODOS: PaymentMethod[] = ["DINHEIRO", "CARTAO_CREDITO", "CARTAO_DEBITO", "PIX", "OUTRO"];

/** Miolo de "Métodos de pagamento" — compartilhado pelo desktop e pelo `/m`. */
export async function ConteudoMetodosPagamento() {
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
      <MetodosPagamentoClient
        porSite={porSite}
        config={config}
        terminais={terminais}
        sites={sites.map((s) => ({ id: s.id, nome: s.nome }))}
      />
    );
  });
}
