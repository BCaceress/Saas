"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { CircleCheck, CircleX, Clock3, FilePenLine, PackageCheck, Search, SlidersHorizontal, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import { PedidoDrawer, PedidoFormSheet, type PedidoView, type FormOptions } from "./_pedidos";
import { PedidoReceber } from "./_recebimentos";
import { fmtHora, fmtMoney, diaLabel } from "./_ui";

// ── Histórico de compras — exclusivo de Compras ───────────────
// Mostra só pedidos de fornecedor (criados/enviados/recebidos/parciais/
// cancelados). Entradas manuais, transferências e ajustes ficam em
// Estoque → Movimentações — histórico separado por design.

const HistoricoCtx = createContext<() => void>(() => {});

export function useAbrirHistorico() {
  return useContext(HistoricoCtx);
}

export function HistoricoComprasProvider({
  pedidos,
  formOptions,
  empresa,
  children,
}: {
  pedidos: PedidoView[];
  formOptions: FormOptions;
  empresa: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [detalhe, setDetalhe] = useState<PedidoView | null>(null);
  const [receber, setReceber] = useState<PedidoView | null>(null);
  const [editar, setEditar] = useState<PedidoView | null>(null);

  return (
    <HistoricoCtx.Provider value={() => setOpen(true)}>
      {children}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Histórico de compras"
        description="Consulte pedidos e recebimentos anteriores."
        width="2xl"
      >
        <HistoricoLista pedidos={pedidos} onAbrir={setDetalhe} />
      </Sheet>

      <PedidoDrawer
        pedido={detalhe}
        empresa={empresa}
        onClose={() => setDetalhe(null)}
        onEditar={(p) => {
          setDetalhe(null);
          setEditar(p);
        }}
        onReceber={(p) => {
          setDetalhe(null);
          setReceber(p);
        }}
      />

      {editar && (
        <PedidoFormSheet
          open
          onClose={() => setEditar(null)}
          mode="editar"
          pedido={editar}
          formOptions={formOptions}
          empresa={empresa}
          onDone={() => setEditar(null)}
        />
      )}

      <Sheet
        open={receber !== null}
        onClose={() => setReceber(null)}
        title={receber ? `Receber ${receber.numero}` : ""}
        description={receber ? `${receber.supplierNome} · confira o que chegou para gerar a entrada no estoque.` : ""}
        width="2xl"
      >
        {receber && <PedidoReceber pedido={receber} onDone={() => setReceber(null)} />}
      </Sheet>
    </HistoricoCtx.Provider>
  );
}

// ── Evento principal de cada linha — o mais relevante, não a linha do tempo toda ──

function eventoPrincipal(p: PedidoView): { label: string; icon: React.ElementType; cls: string; data: string } {
  if (p.status === "CANCELADO" && p.canceladoEm) return { label: "Cancelado", icon: CircleX, cls: "text-danger", data: p.canceladoEm };
  if (p.status === "RECEBIDO" && p.recebidoEm) return { label: "Recebido", icon: CircleCheck, cls: "text-ok", data: p.recebidoEm };
  if (p.status === "RECEBIDO_PARCIAL") return { label: "Recebido parcialmente", icon: PackageCheck, cls: "text-brand", data: p.enviadoEm ?? p.createdAt };
  if (p.status === "AGUARDANDO") return { label: "Aguardando entrega", icon: Clock3, cls: "text-warn", data: p.enviadoEm ?? p.createdAt };
  if (p.status === "ENVIADO" && p.enviadoEm) return { label: "Enviado", icon: Send, cls: "text-blue-600 dark:text-blue-400", data: p.enviadoEm };
  return { label: "Criado", icon: FilePenLine, cls: "text-muted", data: p.createdAt };
}

/** Data usada para ordenar/agrupar: o evento mais recente do pedido. */
const dataRelevante = (p: PedidoView) => eventoPrincipal(p).data;

type FiltroRapido = "todos" | "recebidos" | "cancelados";

/** Padrão da tela: últimos 30 dias — evita listar o histórico inteiro de cara. */
const trintaDiasAtras = () => new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);

function HistoricoLista({ pedidos, onAbrir }: { pedidos: PedidoView[]; onAbrir: (p: PedidoView) => void }) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroRapido>("todos");
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [fornecedorFiltro, setFornecedorFiltro] = useState("");
  const [de, setDe] = useState(trintaDiasAtras);
  const [ate, setAte] = useState("");

  const fornecedores = useMemo(
    () => [...new Map(pedidos.map((p) => [p.supplierId, p.supplierNome])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [pedidos],
  );

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return pedidos
      .filter((p) => {
        if (filtro === "recebidos" && p.status !== "RECEBIDO") return false;
        if (filtro === "cancelados" && p.status !== "CANCELADO") return false;
        if (termo && !`${p.numero} ${p.supplierNome}`.toLowerCase().includes(termo)) return false;
        if (fornecedorFiltro && p.supplierId !== fornecedorFiltro) return false;
        const data = dataRelevante(p);
        if (de && data < `${de}T00:00:00`) return false;
        if (ate && data > `${ate}T23:59:59`) return false;
        return true;
      })
      .sort((a, b) => dataRelevante(b).localeCompare(dataRelevante(a)));
  }, [pedidos, busca, filtro, fornecedorFiltro, de, ate]);

  const grupos = useMemo(() => {
    const map = new Map<string, PedidoView[]>();
    for (const p of filtrados) {
      const k = diaLabel(dataRelevante(p));
      const arr = map.get(k) ?? [];
      arr.push(p);
      map.set(k, arr);
    }
    return [...map.entries()];
  }, [filtrados]);

  const CHIPS: { key: FiltroRapido; label: string }[] = [
    { key: "todos", label: "Todos" },
    { key: "recebidos", label: "Recebidos" },
    { key: "cancelados", label: "Cancelados" },
  ];

  const filtrosAtivos = fornecedorFiltro !== "" || de !== trintaDiasAtras() || ate !== "";

  return (
    <div className="flex flex-col gap-4">
      {/* Busca */}
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar fornecedor ou número do pedido…"
          className="w-full rounded-xl border border-line bg-surface py-2.5 pl-10 pr-3 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
        />
      </div>

      {/* Filtros compactos */}
      <div className="flex flex-wrap items-center gap-1.5">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setFiltro(c.key)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              filtro === c.key ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:bg-surface-2",
            )}
          >
            {c.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setFiltrosAbertos((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            filtrosAbertos || filtrosAtivos ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:bg-surface-2",
          )}
        >
          <SlidersHorizontal size={12} /> Filtros
          {filtrosAtivos && <span className="h-1.5 w-1.5 rounded-full bg-brand" />}
        </button>
      </div>

      {filtrosAbertos && (
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-line bg-surface-2/50 p-3.5 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Fornecedor
            <select
              value={fornecedorFiltro}
              onChange={(e) => setFornecedorFiltro(e.target.value)}
              className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
            >
              <option value="">Todos</option>
              {fornecedores.map(([id, nome]) => (
                <option key={id} value={id}>{nome}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            De
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Até
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink" />
          </label>
          {filtrosAtivos && (
            <button
              type="button"
              onClick={() => {
                setFornecedorFiltro("");
                setDe("");
                setAte("");
              }}
              className="flex items-center gap-1 self-start text-xs font-medium text-muted hover:text-ink sm:col-span-3"
            >
              <X size={12} /> Limpar filtros
            </button>
          )}
        </div>
      )}

      {/* Lista agrupada por dia */}
      {grupos.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">Nenhum pedido encontrado.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {grupos.map(([dia, lista]) => (
            <div key={dia} className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-faint">{dia}</p>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
                {lista.map((p) => {
                  const ev = eventoPrincipal(p);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => onAbrir(p)}
                        className="flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors hover:bg-surface-2/60"
                      >
                        <span className="flex items-center gap-2">
                          <ev.icon size={15} className={cn("shrink-0", ev.cls)} />
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{p.supplierNome}</span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{fmtMoney(p.valorTotal)}</span>
                        </span>
                        <span className="pl-5.75 text-xs text-muted">
                          <span className="font-mono">{p.numero}</span> · {p.totalItems} {p.totalItems === 1 ? "item" : "itens"}
                        </span>
                        <span className="pl-5.75 text-xs text-faint">
                          {ev.label} às {fmtHora(ev.data)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
