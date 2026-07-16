"use client";

import { useState } from "react";
import { CalendarClock, Loader2, User } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  estadoEntrega,
  fmtMoney,
  previsaoLabel,
  relTempo,
  transicaoDrag,
  PEDIDO_A_RECEBER,
  PEDIDO_FLUXO,
  PEDIDO_STATUS,
  SupplierAvatar,
} from "./_ui";
import type { PedidoView } from "./_pedidos";

// ── Visualização kanban — fluxo operacional dos pedidos ────────
// Mesmos dados da lista; só muda a apresentação. Drag-and-drop segue
// as regras de negócio (transicaoDrag): avançar no fluxo sim, voltar não;
// concluir exige a conferência do recebimento.

export function PurchaseOrderKanban({
  pedidos,
  onAbrir,
  onMover,
  movendoId,
}: {
  pedidos: PedidoView[];
  onAbrir: (p: PedidoView) => void;
  /** Solta o card numa coluna — regras/ações ficam com o root. */
  onMover: (p: PedidoView, paraStatus: string) => void;
  /** Pedido com ação de status em andamento (spinner no card). */
  movendoId: string | null;
}) {
  // Pedido sendo arrastado — colunas válidas se destacam enquanto isso.
  const [dragging, setDragging] = useState<PedidoView | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);

  return (
    <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
      {PEDIDO_FLUXO.map((status) => {
        const doStatus = pedidos.filter((p) => p.status === status);
        const valor = doStatus.reduce((a, p) => a + p.valorTotal, 0);
        const meta = PEDIDO_STATUS[status];
        const aceita = dragging ? transicaoDrag(dragging.status, status) !== null : false;
        const ativa = aceita && sobre === status;
        return (
          <section
            key={status}
            onDragOver={(e) => {
              if (!aceita) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setSobre(status);
            }}
            onDragLeave={() => setSobre((s) => (s === status ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setSobre(null);
              if (dragging) onMover(dragging, status);
              setDragging(null);
            }}
            className={cn(
              "flex w-72 shrink-0 snap-start flex-col rounded-2xl border bg-surface-2/50 transition-colors",
              ativa ? "border-brand bg-brand-soft/40" : "border-line",
              dragging && !aceita && "opacity-55",
            )}
          >
            {/* Cabeçalho da coluna: nome + contagem + valor total */}
            <header className="flex items-center gap-2 px-3.5 pb-2 pt-3">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", meta.dot)} />
              <h3 className="text-[13px] font-semibold text-ink">{meta.label}</h3>
              <span className="rounded-full bg-surface px-1.5 py-px text-[11px] font-semibold tabular-nums text-muted">
                {doStatus.length}
              </span>
              {valor > 0 && (
                <span className="ml-auto text-[11px] font-medium tabular-nums text-faint">{fmtMoney(valor)}</span>
              )}
            </header>

            <div className="flex min-h-24 flex-1 flex-col gap-2 px-2.5 pb-2.5">
              {doStatus.length === 0 ? (
                <div
                  className={cn(
                    "grid flex-1 place-items-center rounded-xl border border-dashed px-3 py-6 text-center text-xs",
                    ativa ? "border-brand text-brand" : "border-line text-faint",
                  )}
                >
                  {ativa ? "Solte aqui" : "Sem pedidos"}
                </div>
              ) : (
                doStatus.map((p) => (
                  <PurchaseOrderCard
                    key={p.id}
                    pedido={p}
                    movendo={movendoId === p.id}
                    arrastando={dragging?.id === p.id}
                    onAbrir={() => onAbrir(p)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", p.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(p);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setSobre(null);
                    }}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function PurchaseOrderCard({
  pedido: p,
  movendo,
  arrastando,
  onAbrir,
  onDragStart,
  onDragEnd,
}: {
  pedido: PedidoView;
  movendo: boolean;
  arrastando: boolean;
  onAbrir: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const aberto = PEDIDO_A_RECEBER.includes(p.status);
  const prazo = aberto ? estadoEntrega(p.previsaoEntrega) : null;
  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onAbrir}
      onKeyDown={(e) => e.key === "Enter" && onAbrir()}
      tabIndex={0}
      role="button"
      aria-label={`Pedido ${p.numero} — ${p.supplierNome}`}
      className={cn(
        "flex cursor-grab flex-col gap-2.5 rounded-xl border border-line bg-surface p-3 shadow-(--shadow-1) transition-all",
        "hover:border-line-strong hover:shadow-(--shadow-2)",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
        arrastando && "opacity-40",
        movendo && "pointer-events-none opacity-60",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-ink">{p.numero}</span>
        {movendo && <Loader2 size={13} className="animate-spin text-brand" />}
      </div>

      <div className="flex items-center gap-2">
        <SupplierAvatar nome={p.supplierNome} size={26} />
        <span className="min-w-0 truncate text-sm font-medium text-ink">{p.supplierNome}</span>
      </div>

      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="tabular-nums text-muted">
          {p.totalItems} {p.totalItems === 1 ? "produto" : "produtos"}
        </span>
        <span className="font-semibold tabular-nums text-ink">{fmtMoney(p.valorTotal)}</span>
      </div>

      {(prazo || p.previsaoEntrega) && (
        prazo ? (
          <span className={cn("inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", prazo.cls)}>
            <prazo.icon size={11} /> {prazo.label}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted">
            <CalendarClock size={11} /> Entrega {previsaoLabel(p.previsaoEntrega).toLowerCase()}
          </span>
        )
      )}

      <div className="flex items-center justify-between gap-2 border-t border-line pt-2 text-[11px] text-faint">
        <span>Atualizado {relTempo(p.updatedAt)}</span>
        {p.operador && (
          <span className="inline-flex min-w-0 items-center gap-1">
            <User size={11} /> <span className="max-w-20 truncate">{p.operador.split(" ")[0]}</span>
          </span>
        )}
      </div>
    </article>
  );
}
