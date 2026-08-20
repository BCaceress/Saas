"use client";

import { ClipboardList, PackageCheck, TriangleAlert, Truck, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney, pedidoAtrasado, PEDIDO_ABERTO, PEDIDO_A_RECEBER } from "../cotacoes/_ui";
import type { PedidoView } from "./_pedidos";

// ── Resumo da operação — 4 números discretos no topo ──────────

const hojeStr = () => {
  const h = new Date();
  return `${h.getFullYear()}-${h.getMonth()}-${h.getDate()}`;
};

const diaStr = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export function PurchaseOrderSummary({ pedidos }: { pedidos: PedidoView[] }) {
  const hoje = hojeStr();
  let ativos = 0;
  let aguardandoRecebimento = 0;
  let valorAberto = 0;
  let entregaHoje = 0;
  let atrasados = 0;
  for (const p of pedidos) {
    if (PEDIDO_ABERTO.includes(p.status)) ativos += 1;
    if (PEDIDO_A_RECEBER.includes(p.status)) {
      aguardandoRecebimento += 1;
      valorAberto += p.valorTotal;
      if (p.previsaoEntrega && diaStr(p.previsaoEntrega) === hoje) entregaHoje += 1;
      if (pedidoAtrasado(p.previsaoEntrega)) atrasados += 1;
    }
  }

  const items = [
    { icon: ClipboardList, label: "Pedidos ativos", valor: String(ativos) },
    { icon: PackageCheck, label: "Aguardando recebimento", valor: String(aguardandoRecebimento) },
    { icon: Wallet, label: "Valor em aberto", valor: fmtMoney(valorAberto) },
    { icon: Truck, label: "Entrega hoje", valor: entregaHoje === 1 ? "1 pedido" : `${entregaHoje} pedidos` },
    {
      icon: TriangleAlert,
      label: "Atrasados",
      valor: atrasados === 1 ? "1 pedido" : `${atrasados} pedidos`,
      tom: atrasados > 0 ? ("accent" as const) : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5">
          <span
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
              it.tom === "accent" ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted",
            )}
          >
            <it.icon size={15} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[11px] font-medium text-muted">{it.label}</p>
            <p
              className={cn(
                "truncate font-display text-base font-bold leading-tight tabular-nums",
                it.tom === "accent" ? "text-accent" : "text-ink",
              )}
            >
              {it.valor}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
