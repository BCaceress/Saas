"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Gift, Loader2, PackageCheck, Receipt, TriangleAlert, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney, previsaoLabel, relTempo, PurchaseOrderStatusBadge, SupplierAvatar, PEDIDO_A_RECEBER } from "../cotacoes/_ui";
import type { PedidoView } from "./_pedidos";

// ── Visualização em lista — análise, busca e produtividade ─────

export type PoAcoes = {
  onVer: (p: PedidoView) => void;
  onEditar: (p: PedidoView) => void;
  onDuplicar: (p: PedidoView) => void;
  onCancelar: (p: PedidoView) => void;
  onExcluir: (p: PedidoView) => void;
  onReceber: (p: PedidoView) => void;
};

const POR_PAGINA = 25;

function previsaoComAno(iso: string | null): string {
  if (!iso) return previsaoLabel(iso);
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Só o sinal do prazo — ícone vermelho p/ atraso, âmbar p/ entrega hoje. Sem label. */
function sinalPrazo(iso: string | null): { icon: React.ElementType; cls: string; title: string } | null {
  if (!iso) return null;
  const dia = (x: Date) => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86400000);
  const diff = dia(new Date(iso)) - dia(new Date());
  if (diff < 0) {
    const dias = -diff;
    return { icon: TriangleAlert, cls: "text-danger", title: `Atrasado há ${dias} ${dias === 1 ? "dia" : "dias"}` };
  }
  if (diff === 0) return { icon: Truck, cls: "text-accent", title: "Previsto para hoje" };
  return null;
}

/**
 * Sinais do pedido, colados no número: bonificação (violeta — é o CONTEÚDO do
 * pedido) e NF-e vinculada (cyan — é o DOCUMENTO). Cores diferentes porque é o
 * que faz os dois se lerem de relance. Teto de dois: um terceiro sinal vira
 * coluna, não mais um ícone solto aqui.
 */
function SinaisPedido({ pedido: p, aberto }: { pedido: PedidoView; aberto: boolean }) {
  const temBonificacao = p.items.some((i) => i.tipo !== "COMPRA");
  return (
    <>
      {temBonificacao && (
        <span title="Tem bonificação" aria-label="Tem bonificação" className="inline-flex shrink-0 text-violet">
          <Gift size={12} />
        </span>
      )}
      {/* Só enquanto há o que receber: em pedido já fechado toda linha teria o
          ícone, e sinal sempre aceso não é sinal. */}
      {aberto && p.temNota && (
        <span title="NF-e vinculada — a conferência sai pelo XML" aria-label="NF-e vinculada" className="inline-flex shrink-0 text-brand">
          <Receipt size={12} />
        </span>
      )}
    </>
  );
}

export function PurchaseOrderList({
  pedidos,
  acoes,
  statusPendingId = null,
  compacta = false,
}: {
  pedidos: PedidoView[];
  acoes: PoAcoes;
  /** Id do pedido cujo status está sendo alterado — mostra loading na coluna Status. */
  statusPendingId?: string | null;
  /** Versão mobile — cards empilhados em vez de tabela. */
  compacta?: boolean;
}) {
  const [pagina, setPagina] = useState(1);
  const totalPaginas = Math.max(1, Math.ceil(pedidos.length / POR_PAGINA));
  const pg = Math.min(pagina, totalPaginas);
  const rows = pedidos.slice((pg - 1) * POR_PAGINA, pg * POR_PAGINA);

  if (compacta) {
    return (
      <div className="flex flex-col gap-2">
        {rows.map((p) => <PurchaseOrderCardRow key={p.id} pedido={p} acoes={acoes} statusPending={p.id === statusPendingId} />)}
        <Paginacao pagina={pg} total={totalPaginas} onPage={setPagina} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wide text-faint">
              <th className="px-4 py-2.5">Pedido</th>
              <th className="px-4 py-2.5">Fornecedor</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Produtos</th>
              <th className="px-4 py-2.5 text-right">Valor total</th>
              <th className="px-4 py-2.5">Entrega prevista</th>
              <th className="px-4 py-2.5">Última atualização</th>
              <th className="px-4 py-2.5">Responsável</th>
              <th className="w-px px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((p) => <PurchaseOrderRow key={p.id} pedido={p} acoes={acoes} statusPending={p.id === statusPendingId} />)}
          </tbody>
        </table>
      </div>
      <Paginacao pagina={pg} total={totalPaginas} onPage={setPagina} />
    </div>
  );
}

export function PurchaseOrderRow({ pedido: p, acoes, statusPending = false }: { pedido: PedidoView; acoes: PoAcoes; statusPending?: boolean }) {
  const aberto = PEDIDO_A_RECEBER.includes(p.status);
  const prazo = aberto ? sinalPrazo(p.previsaoEntrega) : null;
  return (
    <tr
      onClick={() => acoes.onVer(p)}
      className="group cursor-pointer transition-colors hover:bg-surface-2/60"
    >
      <td className="px-4 py-2.5">
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-[13px] font-semibold text-ink">{p.numero}</span>
          <SinaisPedido pedido={p} aberto={aberto} />
        </span>
        <span className="block text-[11px] text-faint">{p.siteNome}</span>
      </td>
      <td className="px-4 py-2.5">
        <span className="flex items-center gap-2">
          <SupplierAvatar nome={p.supplierNome} logoUrl={p.supplierLogoUrl} />
          <span className="max-w-44 truncate font-medium text-ink">{p.supplierNome}</span>
        </span>
      </td>
      <td className="px-4 py-2.5">
        {statusPending ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-muted">
            <Loader2 size={12} className="animate-spin" /> Atualizando…
          </span>
        ) : (
          <PurchaseOrderStatusBadge status={p.status} />
        )}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-ink">{p.totalItems}</td>
      <td className="px-4 py-2.5 text-right font-medium tabular-nums text-ink">{fmtMoney(p.valorTotal)}</td>
      <td className="px-4 py-2.5">
        <span className="flex items-center gap-1.5 whitespace-nowrap text-muted">
          {previsaoComAno(p.previsaoEntrega)}
          {prazo && (
            <span title={prazo.title} aria-label={prazo.title} className={cn("inline-flex shrink-0", prazo.cls)}>
              <prazo.icon size={14} />
            </span>
          )}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-muted">{relTempo(p.updatedAt)}</td>
      <td className="max-w-32 truncate px-4 py-2.5 text-muted">{p.operador ?? "—"}</td>
      <td className="w-px whitespace-nowrap px-4 py-2.5 text-right">
        {aberto && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              acoes.onReceber(p);
            }}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-on-brand transition-colors hover:bg-brand-strong"
          >
            <PackageCheck size={13} /> Receber
          </button>
        )}
      </td>
    </tr>
  );
}

/** Linha-card usada na versão mobile da lista. */
function PurchaseOrderCardRow({ pedido: p, acoes, statusPending = false }: { pedido: PedidoView; acoes: PoAcoes; statusPending?: boolean }) {
  const aberto = PEDIDO_A_RECEBER.includes(p.status);
  const prazo = aberto ? sinalPrazo(p.previsaoEntrega) : null;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => acoes.onVer(p)}
      onKeyDown={(e) => e.key === "Enter" && acoes.onVer(p)}
      className="flex cursor-pointer flex-col gap-2 rounded-xl border border-line bg-surface p-3.5 transition-colors hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-[13px] font-semibold text-ink">{p.numero}</span>
          <SinaisPedido pedido={p} aberto={aberto} />
        </span>
        {statusPending ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-muted">
            <Loader2 size={12} className="animate-spin" /> Atualizando…
          </span>
        ) : (
          <PurchaseOrderStatusBadge status={p.status} />
        )}
      </div>
      <div className="flex items-center gap-2">
        <SupplierAvatar nome={p.supplierNome} logoUrl={p.supplierLogoUrl} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{p.supplierNome}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="tabular-nums">{p.totalItems}</span>
        <span className="font-medium tabular-nums text-ink">{fmtMoney(p.valorTotal)}</span>
        {p.previsaoEntrega && (
          <span className="inline-flex items-center gap-1.5">
            Entrega {previsaoComAno(p.previsaoEntrega)}
            {prazo && (
              <span title={prazo.title} aria-label={prazo.title} className={cn("inline-flex shrink-0", prazo.cls)}>
                <prazo.icon size={14} />
              </span>
            )}
          </span>
        )}
        <span className="text-faint">{relTempo(p.updatedAt)}</span>
      </div>
      {aberto && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            acoes.onReceber(p);
          }}
          className="flex items-center justify-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
        >
          <PackageCheck size={14} /> Receber
        </button>
      )}
    </div>
  );
}

function Paginacao({ pagina, total, onPage }: { pagina: number; total: number; onPage: (p: number) => void }) {
  if (total <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => onPage(pagina - 1)}
        disabled={pagina <= 1}
        aria-label="Página anterior"
        className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
      >
        <ChevronLeft size={15} />
      </button>
      <span className="px-2 text-xs font-medium tabular-nums text-muted">{pagina} <span className="text-faint">/ {total}</span></span>
      <button
        type="button"
        onClick={() => onPage(pagina + 1)}
        disabled={pagina >= total}
        aria-label="Próxima página"
        className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
      >
        <ChevronRight size={15} />
      </button>
    </div>
  );
}
