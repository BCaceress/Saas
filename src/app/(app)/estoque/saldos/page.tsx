import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { loadSaldos } from "../_data";
import { AlertTriangle, AlertOctagon, PackageOpen, Layers, Barcode } from "lucide-react";
import { cn } from "@/lib/utils";

const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const fmtMoney = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default async function SaldosPage() {
  const ctx = await requireActiveTenant();
  const [siteId, saldos] = await withTenant(ctx, async () => {
    const sid = await getActiveSiteId();
    const s = await loadSaldos(sid);
    return [sid, s] as const;
  });

  const abaixoMinimo = saldos.filter((s) => s.abaixoMinimo);
  const semEstoque = saldos.filter((s) => s.estoqueFechado === 0 && s.estoqueAberto === 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Summary chips */}
      {(abaixoMinimo.length > 0 || semEstoque.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {abaixoMinimo.length > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-warn-soft px-3 py-1.5 text-xs font-semibold text-warn">
              <AlertTriangle size={13} />
              {abaixoMinimo.length} {abaixoMinimo.length === 1 ? "produto abaixo" : "produtos abaixo"} do mínimo
            </span>
          )}
          {semEstoque.length > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-danger-soft px-3 py-1.5 text-xs font-semibold text-danger">
              <PackageOpen size={13} />
              {semEstoque.length} sem estoque
            </span>
          )}
        </div>
      )}

      {saldos.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-xl)] border border-line bg-surface py-16 text-center">
          <Layers size={36} className="text-faint" />
          <p className="text-sm font-medium text-muted">Nenhum produto com estoque neste site.</p>
          <p className="text-xs text-faint">Registre uma entrada para começar a controlar o estoque.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-semibold uppercase tracking-wide text-faint">
                <th className="px-4 py-3">Produto</th>
                <th className="px-4 py-3">Código de barras</th>
                <th className="px-4 py-3 text-right">Fechado</th>
                <th className="px-4 py-3">Aberta</th>
                <th className="px-4 py-3 text-right">Mínimo</th>
                <th className="px-4 py-3 text-right">Custo médio</th>
                <th className="px-4 py-3">Local</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {saldos.map((s) => {
                const zerado = s.estoqueFechado === 0 && s.estoqueAberto === 0;
                const critico = zerado || (s.estoqueMinimo > 0 && s.estoqueFechado <= s.estoqueMinimo / 2);
                const baixo = s.abaixoMinimo && !critico;
                return (
                <tr
                  key={s.productId}
                  className={cn(
                    "transition-colors hover:bg-surface-2",
                    critico ? "bg-danger-soft/30" : baixo && "bg-warn-soft/30"
                  )}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {critico ? (
                        <AlertOctagon size={18} className="shrink-0 text-danger" />
                      ) : baixo ? (
                        <AlertTriangle size={16} className="shrink-0 text-warn" />
                      ) : null}
                      <div>
                        <p className="font-medium text-ink">{s.nome}</p>
                        <p className="text-[11px] font-mono text-faint">{s.sku}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {s.ean ? (
                      <span className="flex items-center gap-1.5 font-mono text-xs text-muted">
                        <Barcode size={14} className="shrink-0 text-faint" />
                        {s.ean}
                      </span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink">
                    {fmt(s.estoqueFechado)}
                    <span className="ml-1 text-[11px] text-faint">un</span>
                  </td>
                  <td className="px-4 py-3">
                    {s.fracionavel && s.conteudoPorUnidade ? (
                      <div className="flex items-center gap-2">
                        <div className="w-20">
                          <div className="flex justify-between text-[10px] text-muted mb-0.5">
                            <span>{fmt(s.estoqueAberto)} {s.unidadeBase.toLowerCase()}</span>
                            <span>{s.percentAberta ?? 0}%</span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                            <div
                              className="h-full rounded-full bg-brand transition-all"
                              style={{ width: `${Math.min(100, s.percentAberta ?? 0)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className={cn(
                    "px-4 py-3 text-right tabular-nums",
                    s.abaixoMinimo ? "font-semibold text-warn" : "text-muted"
                  )}>
                    {fmt(s.estoqueMinimo)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted">
                    {s.custoMedio != null ? fmtMoney(s.custoMedio) : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {s.locationNome ?? <span className="text-faint">—</span>}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
