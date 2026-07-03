"use client";

import { useState, type ComponentProps } from "react";
import { ShoppingCart, PackageCheck, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { ComprasClient } from "./_pedidos";
import { RecebimentosClient } from "./_recebimentos";
import { ExtratoEntradas } from "./_historico";

type SubTab = "pedidos" | "receber" | "historico";

export function ComprasHub({
  compras,
  receber,
  eventos,
}: {
  compras: ComponentProps<typeof ComprasClient>;
  receber: ComponentProps<typeof RecebimentosClient>;
  eventos: ComponentProps<typeof ExtratoEntradas>["eventos"];
}) {
  const [tab, setTab] = useState<SubTab>("pedidos");

  const receberCount = receber.pedidos.length + receber.transferencias.length;

  const subtabs = [
    { key: "pedidos" as const, label: "Pedidos", icon: ShoppingCart, count: compras.pedidos.length },
    { key: "receber" as const, label: "A receber", icon: PackageCheck, count: receberCount },
    { key: "historico" as const, label: "Histórico", icon: History, count: eventos.length },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Sub-abas: etapa da mercadoria */}
      <div className="flex items-center gap-1 rounded-xl border border-line bg-surface-2 p-1">
        {subtabs.map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              tab === key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            <Icon size={15} />
            {label}
            {count > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[10px] tabular-nums",
                  tab === key ? "bg-brand/10 text-brand" : "bg-surface text-faint",
                )}
              >
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "pedidos" && <ComprasClient {...compras} />}
      {tab === "receber" && <RecebimentosClient {...receber} />}
      {tab === "historico" && <ExtratoEntradas eventos={eventos} />}
    </div>
  );
}
