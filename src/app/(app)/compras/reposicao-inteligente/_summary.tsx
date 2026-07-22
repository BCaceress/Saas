"use client";

import { cn } from "@/lib/utils";
import { fmtMoney } from "../_ui";

// ── Dashboard da reposição — responde "o que preciso comprar hoje?" ──
// Grid único com divisores (não cards soltos). Os números reagem ao vivo
// à seleção do operador. Cada célula traz borda top/left e o wrapper
// esconde a primeira linha/coluna com -m-px — divisores certos em
// qualquer quebra responsiva.

export function ReplenishmentSummary({
  sugeridos,
  urgentes,
  selecionados,
  fornecedores,
  pedidos,
  valor,
}: {
  sugeridos: number;
  urgentes: number;
  selecionados: number;
  fornecedores: number;
  pedidos: number;
  valor: number;
}) {
  const metricas: { rotulo: string; valor: string; tom?: "danger" | "brand" }[] = [
    { rotulo: "Produtos sugeridos", valor: String(sugeridos) },
    { rotulo: "Urgentes", valor: String(urgentes), tom: urgentes > 0 ? "danger" : undefined },
    { rotulo: "Selecionados", valor: String(selecionados) },
    { rotulo: "Fornecedores", valor: String(fornecedores) },
    { rotulo: "Pedidos a criar", valor: String(pedidos) },
    { rotulo: "Valor estimado", valor: fmtMoney(valor), tom: "brand" },
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-(--shadow-1)">
      <div className="-m-px grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {metricas.map((m) => (
          <div key={m.rotulo} className="flex flex-col gap-0.5 border-l border-t border-line px-4 py-3">
            <span className="truncate text-[11px] font-medium text-muted">{m.rotulo}</span>
            <span
              className={cn(
                "font-display text-lg font-bold tabular-nums leading-tight",
                m.tom === "danger" ? "text-danger" : m.tom === "brand" ? "text-brand" : "text-ink",
              )}
            >
              {m.valor}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
