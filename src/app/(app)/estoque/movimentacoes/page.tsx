import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { loadMovimentacoes } from "../_data";
import { cn } from "@/lib/utils";

const TIPO_LABEL: Record<string, string> = {
  ENTRADA: "Entrada",
  SAIDA: "Saída",
  AJUSTE: "Ajuste",
  TRANSFERENCIA: "Transferência",
  ABERTURA: "Abertura",
  PRODUCAO: "Produção",
  PERDA: "Perda",
};

const TIPO_COLOR: Record<string, string> = {
  ENTRADA: "bg-ok-soft text-ok",
  SAIDA: "bg-danger-soft text-danger",
  AJUSTE: "bg-accent-soft text-accent",
  TRANSFERENCIA: "bg-brand-soft text-brand",
  ABERTURA: "bg-warn-soft text-warn",
  PRODUCAO: "bg-warn-soft text-warn",
  PERDA: "bg-danger-soft text-danger",
};

const fmt = (v: number, prefix = "") =>
  `${v > 0 ? "+" : ""}${prefix}${v.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}`;

const fmtDate = (d: Date) =>
  d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default async function MovimentacoesPage() {
  const ctx = await requireActiveTenant();
  const [siteId, rows] = await withTenant(ctx, async () => {
    const sid = await getActiveSiteId();
    const r = await loadMovimentacoes(sid, { limit: 200 });
    return [sid, r] as const;
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Razão append-only — toda mudança de saldo registrada aqui.</p>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[var(--radius-xl)] border border-line bg-surface py-16 text-center">
          <p className="text-sm text-muted">Nenhuma movimentação registrada ainda.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-semibold uppercase tracking-wide text-faint">
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Produto</th>
                <th className="px-4 py-3 text-right">Δ Fechado</th>
                <th className="px-4 py-3 text-right">Δ Aberto</th>
                <th className="px-4 py-3 text-right">Custo un.</th>
                <th className="px-4 py-3">Observação</th>
                <th className="px-4 py-3">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", TIPO_COLOR[r.tipo] ?? "bg-surface-2 text-muted")}>
                      {TIPO_LABEL[r.tipo] ?? r.tipo}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{r.productNome}</p>
                    <p className="font-mono text-[11px] text-faint">{r.productSku}</p>
                  </td>
                  <td className={cn("px-4 py-3 text-right font-mono text-xs tabular-nums",
                    r.deltaFechado > 0 ? "text-ok" : r.deltaFechado < 0 ? "text-danger" : "text-faint"
                  )}>
                    {r.deltaFechado !== 0 ? fmt(r.deltaFechado) : "—"}
                  </td>
                  <td className={cn("px-4 py-3 text-right font-mono text-xs tabular-nums",
                    r.deltaAberto > 0 ? "text-ok" : r.deltaAberto < 0 ? "text-danger" : "text-faint"
                  )}>
                    {r.deltaAberto !== 0 ? fmt(r.deltaAberto) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted">
                    {r.custoUnitario != null
                      ? r.custoUnitario.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                      : "—"}
                  </td>
                  <td className="max-w-[160px] truncate px-4 py-3 text-muted">{r.observacao ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
