"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  Package,
  Search,
  PackageMinus,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { registrarPerdaAction } from "../actions";
import type { LoteRow } from "../_data";

type Filtro = "alerta" | "vencido" | "vencendo" | "todos";

const fmtData = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

function prazoLabel(r: LoteRow): { texto: string; cor: string } {
  if (r.diasParaVencer == null) return { texto: "Sem validade", cor: "text-faint" };
  const d = r.diasParaVencer;
  if (d < 0) return { texto: `Vencido há ${Math.abs(d)} ${Math.abs(d) === 1 ? "dia" : "dias"}`, cor: "text-danger" };
  if (d === 0) return { texto: "Vence hoje", cor: "text-danger" };
  if (d <= 7) return { texto: `Vence em ${d} ${d === 1 ? "dia" : "dias"}`, cor: "text-warn" };
  if (d <= 30) return { texto: `Vence em ${d} dias`, cor: "text-warn" };
  return { texto: `Vence em ${d} dias`, cor: "text-muted" };
}

export function ValidadeView({
  rows,
  alertaDias,
  siteId,
}: {
  rows: LoteRow[];
  alertaDias: number;
  siteId: string | null;
}) {
  const router = useRouter();
  const [filtro, setFiltro] = useState<Filtro>("alerta");
  const [busca, setBusca] = useState("");
  const [baixando, startBaixa] = useTransition();
  const [baixaId, setBaixaId] = useState<string | null>(null);

  const contagem = useMemo(() => {
    let vencido = 0, vencendo = 0;
    for (const r of rows) {
      if (r.status === "vencido") vencido += 1;
      else if (r.status === "vencendo") vencendo += 1;
    }
    return { vencido, vencendo, alerta: vencido + vencendo };
  }, [rows]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return rows.filter((r) => {
      if (filtro === "alerta" && r.status !== "vencido" && r.status !== "vencendo") return false;
      if (filtro === "vencido" && r.status !== "vencido") return false;
      if (filtro === "vencendo" && r.status !== "vencendo") return false;
      if (termo && !`${r.nome} ${r.sku} ${r.lote ?? ""}`.toLowerCase().includes(termo)) return false;
      return true;
    });
  }, [rows, filtro, busca]);

  function darBaixa(r: LoteRow) {
    if (!siteId) return;
    const prazo = prazoLabel(r);
    setBaixaId(r.id);
    startBaixa(async () => {
      try {
        await registrarPerdaAction({
          siteId,
          productId: r.productId,
          deltaFechado: r.quantidade,
          deltaAberto: 0,
          observacao: `Baixa por validade${r.lote ? ` — lote ${r.lote}` : ""} (${prazo.texto.toLowerCase()})`,
        });
        router.refresh();
      } finally {
        setBaixaId(null);
      }
    });
  }

  const CHIPS: { id: Filtro; label: string; count?: number }[] = [
    { id: "alerta", label: "Em alerta", count: contagem.alerta },
    { id: "vencido", label: "Vencidos", count: contagem.vencido },
    { id: "vencendo", label: `Vencendo (${alertaDias}d)`, count: contagem.vencendo },
    { id: "todos", label: "Todos os lotes" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Validade"
        icon={CalendarClock}
        description="Lotes com validade próxima ou vencida. O sistema consome sempre o lote de validade mais próxima primeiro (FEFO)."
        innerClassName="max-w-none"
        className="pb-3"
      />

      {/* Controles */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por produto, SKU ou lote…"
            className="w-full rounded-full border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setFiltro(c.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                filtro === c.id
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-line bg-surface text-muted hover:bg-surface-2",
              )}
            >
              {c.label}
              {c.count != null && c.count > 0 && (
                <span className={cn(
                  "rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums",
                  c.id === "vencido" ? "bg-danger-soft text-danger" : "bg-surface-2 text-muted",
                )}>
                  {c.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {filtradas.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-line px-6 py-16 text-center">
          <CheckCircle2 size={28} className="text-ok" />
          <p className="text-sm font-medium text-ink">Nenhum lote nesta condição.</p>
          <p className="text-xs text-muted">
            {filtro === "alerta"
              ? "Nada vencido ou perto de vencer. Estoque em dia."
              : "Ajuste o filtro ou a busca para ver outros lotes."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-[var(--radius-lg)] border border-line">
          {filtradas.map((r) => {
            const prazo = prazoLabel(r);
            const alerta = r.status === "vencido" || r.status === "vencendo";
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                <span className={cn(
                  "grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[var(--radius)] border",
                  r.status === "vencido" ? "border-danger/40 bg-danger-soft/40" : "border-line bg-surface-2",
                )}>
                  {r.imagemUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.imagemUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Package size={16} className="text-faint" />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{r.nome}</p>
                  <p className="truncate font-mono text-[11px] text-faint">
                    {r.sku}
                    {r.lote ? ` · lote ${r.lote}` : ""}
                  </p>
                </div>

                <div className="w-24 text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">Validade</p>
                  <p className="text-sm tabular-nums text-ink">{fmtData(r.validade)}</p>
                </div>

                <div className="w-32 text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">Prazo</p>
                  <p className={cn("text-xs font-semibold", prazo.cor)}>{prazo.texto}</p>
                </div>

                <div className="w-16 text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">Saldo</p>
                  <p className="text-sm font-semibold tabular-nums text-ink">
                    {r.quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                  </p>
                </div>

                {alerta && siteId && (
                  <button
                    type="button"
                    onClick={() => darBaixa(r)}
                    disabled={baixando && baixaId === r.id}
                    title="Registrar perda deste lote"
                    className="flex shrink-0 items-center gap-1.5 rounded-full border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
                  >
                    {baixando && baixaId === r.id ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <PackageMinus size={13} />
                    )}
                    Dar baixa
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
