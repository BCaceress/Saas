import Link from "next/link";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { loadReposicao } from "../_data";
import { AlertTriangle, ShoppingCart, CheckCircle2 } from "lucide-react";

const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

export default async function ReposicaoPage() {
  const ctx = await requireActiveTenant();
  const [siteId, rows] = await withTenant(ctx, async () => {
    const sid = await getActiveSiteId();
    const r = await loadReposicao(sid);
    return [sid, r] as const;
  });

  // Agrupa por fornecedor principal
  const porFornecedor = rows.reduce<Record<string, { supplierNome: string | null; supplierId: string | null; items: typeof rows }>>((acc, row) => {
    const key = row.supplierId ?? "__sem_fornecedor";
    if (!acc[key]) acc[key] = { supplierNome: row.supplierNome, supplierId: row.supplierId, items: [] };
    acc[key].items.push(row);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Produtos abaixo do estoque mínimo, agrupados por fornecedor principal.
      </p>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-xl)] border border-line bg-surface py-16 text-center">
          <CheckCircle2 size={36} className="text-ok" />
          <p className="text-sm font-medium text-muted">Tudo em ordem — nenhum produto abaixo do mínimo.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {Object.entries(porFornecedor).map(([key, group]) => (
            <div key={key} className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
              <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-4 py-3">
                <div className="flex items-center gap-2">
                  <ShoppingCart size={15} className="text-brand" />
                  <span className="text-sm font-semibold text-ink">
                    {group.supplierNome ?? "Sem fornecedor definido"}
                  </span>
                </div>
                <Link
                  href={`/estoque/entradas/nova${group.supplierId ? `?supplierId=${group.supplierId}` : ""}`}
                  className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-on-brand transition-colors hover:bg-brand-strong"
                >
                  Registrar entrada
                </Link>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-faint">
                    <th className="px-4 py-2.5">Produto</th>
                    <th className="px-4 py-2.5 text-right">Atual</th>
                    <th className="px-4 py-2.5 text-right">Mínimo</th>
                    <th className="px-4 py-2.5 text-right text-brand">Sugerir comprar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {group.items.map((r) => (
                    <tr key={r.productId} className="hover:bg-surface-2">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <AlertTriangle size={13} className="shrink-0 text-warn" />
                          <div>
                            <p className="font-medium text-ink">{r.nome}</p>
                            <p className="font-mono text-[11px] text-faint">{r.sku}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-danger font-semibold">{fmt(r.estoqueFechado)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted">{fmt(r.estoqueMinimo)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-brand">{fmt(r.deficit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
