"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Eye, MoreHorizontal, Pencil, CircleX, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Menu, MenuItem } from "@/components/ui/menu";
import { estadoEntrega, fmtMoney, previsaoLabel, relTempo, PurchaseOrderStatusBadge, SupplierAvatar, PEDIDO_A_RECEBER } from "./_ui";
import type { PedidoView } from "./_pedidos";

// ── Visualização em lista — análise, busca e produtividade ─────

export type PoAcoes = {
  onVer: (p: PedidoView) => void;
  onEditar: (p: PedidoView) => void;
  onDuplicar: (p: PedidoView) => void;
  onCancelar: (p: PedidoView) => void;
  onExcluir: (p: PedidoView) => void;
};

const POR_PAGINA = 25;

export function PurchaseOrderList({
  pedidos,
  acoes,
  compacta = false,
}: {
  pedidos: PedidoView[];
  acoes: PoAcoes;
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
        {rows.map((p) => <PurchaseOrderCardRow key={p.id} pedido={p} acoes={acoes} />)}
        <Paginacao pagina={pg} total={totalPaginas} onPage={setPagina} count={pedidos.length} />
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
              <th className="px-3 py-2.5 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((p) => <PurchaseOrderRow key={p.id} pedido={p} acoes={acoes} />)}
          </tbody>
        </table>
      </div>
      <Paginacao pagina={pg} total={totalPaginas} onPage={setPagina} count={pedidos.length} />
    </div>
  );
}

export function PurchaseOrderRow({ pedido: p, acoes }: { pedido: PedidoView; acoes: PoAcoes }) {
  const aberto = PEDIDO_A_RECEBER.includes(p.status);
  const prazo = aberto ? estadoEntrega(p.previsaoEntrega) : null;
  return (
    <tr
      onClick={() => acoes.onVer(p)}
      className="group cursor-pointer transition-colors hover:bg-surface-2/60"
    >
      <td className="px-4 py-2.5">
        <span className="font-mono text-[13px] font-semibold text-ink">{p.numero}</span>
        <span className="block text-[11px] text-faint">{p.siteNome}</span>
      </td>
      <td className="px-4 py-2.5">
        <span className="flex items-center gap-2">
          <SupplierAvatar nome={p.supplierNome} />
          <span className="max-w-44 truncate font-medium text-ink">{p.supplierNome}</span>
        </span>
      </td>
      <td className="px-4 py-2.5"><PurchaseOrderStatusBadge status={p.status} /></td>
      <td className="px-4 py-2.5 text-right tabular-nums text-ink">
        {p.totalItems} {p.totalItems === 1 ? "produto" : "produtos"}
      </td>
      <td className="px-4 py-2.5 text-right font-medium tabular-nums text-ink">{fmtMoney(p.valorTotal)}</td>
      <td className="px-4 py-2.5">
        {prazo ? (
          <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", prazo.cls)}>
            <prazo.icon size={11} /> {prazo.label}
          </span>
        ) : (
          <span className="text-muted">{previsaoLabel(p.previsaoEntrega)}</span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-muted">{relTempo(p.updatedAt)}</td>
      <td className="max-w-32 truncate px-4 py-2.5 text-muted">{p.operador ?? "—"}</td>
      <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
        <span className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => acoes.onVer(p)}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-2"
          >
            <Eye size={13} className="text-muted" /> Ver pedido
          </button>
          <AcoesMenu pedido={p} acoes={acoes} />
        </span>
      </td>
    </tr>
  );
}

/** Linha-card usada na versão mobile da lista. */
function PurchaseOrderCardRow({ pedido: p, acoes }: { pedido: PedidoView; acoes: PoAcoes }) {
  const aberto = PEDIDO_A_RECEBER.includes(p.status);
  const prazo = aberto ? estadoEntrega(p.previsaoEntrega) : null;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => acoes.onVer(p)}
      onKeyDown={(e) => e.key === "Enter" && acoes.onVer(p)}
      className="flex cursor-pointer flex-col gap-2 rounded-xl border border-line bg-surface p-3.5 transition-colors hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[13px] font-semibold text-ink">{p.numero}</span>
        <PurchaseOrderStatusBadge status={p.status} />
      </div>
      <div className="flex items-center gap-2">
        <SupplierAvatar nome={p.supplierNome} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{p.supplierNome}</span>
        <span onClick={(e) => e.stopPropagation()}><AcoesMenu pedido={p} acoes={acoes} /></span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="tabular-nums">{p.totalItems} {p.totalItems === 1 ? "produto" : "produtos"}</span>
        <span className="font-medium tabular-nums text-ink">{fmtMoney(p.valorTotal)}</span>
        {prazo ? (
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", prazo.cls)}>
            <prazo.icon size={11} /> {prazo.label}
          </span>
        ) : (
          p.previsaoEntrega && <span>Entrega {previsaoLabel(p.previsaoEntrega).toLowerCase()}</span>
        )}
        <span className="text-faint">{relTempo(p.updatedAt)}</span>
      </div>
    </div>
  );
}

function AcoesMenu({ pedido: p, acoes }: { pedido: PedidoView; acoes: PoAcoes }) {
  const podeEditar = p.status === "RASCUNHO";
  const podeExcluir = p.status === "RASCUNHO";
  const podeCancelar = p.status !== "RECEBIDO" && p.status !== "CANCELADO";
  return (
    <Menu
      align="end"
      className="w-44"
      trigger={
        <button
          type="button"
          aria-label={`Ações do pedido ${p.numero}`}
          className="grid h-7 w-7 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <MoreHorizontal size={15} />
        </button>
      }
    >
      {podeEditar && (
        <MenuItem icon={<Pencil size={14} />} onClick={() => acoes.onEditar(p)}>Editar</MenuItem>
      )}
      <MenuItem icon={<Copy size={14} />} onClick={() => acoes.onDuplicar(p)}>Duplicar</MenuItem>
      {podeCancelar && (
        <MenuItem icon={<CircleX size={14} />} onClick={() => acoes.onCancelar(p)}>Cancelar</MenuItem>
      )}
      {podeExcluir && (
        <MenuItem icon={<Trash2 size={14} />} onClick={() => acoes.onExcluir(p)}>Excluir</MenuItem>
      )}
    </Menu>
  );
}

function Paginacao({ pagina, total, count, onPage }: { pagina: number; total: number; count: number; onPage: (p: number) => void }) {
  if (total <= 1) {
    return <p className="text-xs text-muted">{count} {count === 1 ? "pedido" : "pedidos"}</p>;
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-muted">{count} {count === 1 ? "pedido" : "pedidos"}</p>
      <div className="flex items-center gap-1">
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
    </div>
  );
}
