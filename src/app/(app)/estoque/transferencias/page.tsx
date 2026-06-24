import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { loadSitesTransferencia } from "../_data";
import { db } from "@/lib/prisma";
import { TransferenciaForm } from "./_client";

export default async function TransferenciasPage() {
  const ctx = await requireActiveTenant();
  const [sites, products] = await withTenant(ctx, async () => {
    const [ss, ps] = await Promise.all([
      loadSitesTransferencia(),
      db.product.findMany({
        where: { ativo: true, tipo: { in: ["SIMPLES", "INSUMO"] } },
        orderBy: { nome: "asc" },
        select: { id: true, nome: true, sku: true },
      }),
    ]);
    return [ss, ps] as const;
  });

  if (sites.length < 2) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[var(--radius-xl)] border border-line bg-surface py-16 text-center">
        <p className="text-sm font-medium text-muted">Transferências disponíveis somente com dois ou mais sites ativos.</p>
        <a href="/configuracoes/sites" className="text-sm text-brand underline">Gerenciar sites</a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-ink">Transferência entre sites</h2>
        <p className="text-sm text-muted">Move unidades fechadas de um site para outro em uma operação atômica.</p>
      </div>
      <TransferenciaForm sites={sites} products={products} />
    </div>
  );
}
