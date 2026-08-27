"use client";

import { ClipboardList, PackageCheck, PackageOpen, TriangleAlert, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResumoPedidos } from "../estoque/_data";

// ── Resumo da operação ────────────────────────────────────────
//
// Um bloco com divisores, não cinco cards soltos. Cinco caixas com borda
// própria criam dez linhas verticais onde deveriam existir quatro, e a faixa
// briga com a tabela logo abaixo em vez de servir de cabeçalho para ela. É o
// mesmo desenho de `MetricaGrid`, que o resto do app já usa.
//
// A faixa é deliberadamente baixa (~76px): a tabela é o elemento principal da
// tela, e cada pixel gasto aqui é uma linha de pedido que o operador precisa
// rolar para ver. Por isso o subtítulo é curto — cabe numa linha, sem quebrar.
//
// Os números são do TENANT, não da página: cinco totais que mudam a cada
// filtro não são resumo. O operador leria "3 atrasados" achando que são todos.
//
// Todos medem o CICLO DO PEDIDO. Quantos recebimentos estão em conferência ou
// com divergência é resumo de /recebimento — repetir aqui faria as duas telas
// contarem a mesma coisa com nomes diferentes.

type Item = {
  icon: React.ElementType;
  label: string;
  valor: string;
  sub: string;
  tom?: "accent" | "danger";
};

export function PurchaseOrderSummary({ resumo }: { resumo: ResumoPedidos }) {
  const items: Item[] = [
    {
      icon: ClipboardList,
      label: "Pedidos ativos",
      valor: String(resumo.ativos),
      sub: "do rascunho à conclusão",
    },
    {
      icon: PackageCheck,
      label: "Aguardando recebimento",
      valor: String(resumo.aguardandoRecebimento),
      sub: "nada chegou ainda",
    },
    {
      icon: PackageOpen,
      label: "Parcialmente recebido",
      valor: String(resumo.parciais),
      sub: "em andamento",
      tom: resumo.parciais > 0 ? "accent" : undefined,
    },
    {
      icon: Truck,
      label: "Entrega hoje",
      valor: String(resumo.entregaHoje),
      sub: "pedidos previstos",
    },
    {
      icon: TriangleAlert,
      label: "Atrasados",
      valor: String(resumo.atrasados),
      sub: "passaram da previsão",
      tom: resumo.atrasados > 0 ? "danger" : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
      {items.map((it) => (
        <div key={it.label} className="min-w-0 px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-faint uppercase">
            <it.icon
              size={11}
              className={cn(it.tom === "danger" && "text-danger", it.tom === "accent" && "text-accent")}
            />
            <span className="truncate">{it.label}</span>
          </div>
          {/* Número e legenda na mesma linha: empilhar custa ~18px de altura
              em cinco colunas para dizer o que cabe ao lado. */}
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span
              className={cn(
                "font-display text-[19px] leading-none font-semibold tabular-nums",
                it.tom === "danger" ? "text-danger" : it.tom === "accent" ? "text-accent" : "text-ink",
              )}
            >
              {it.valor}
            </span>
            <span className="min-w-0 truncate text-[11px] text-muted">{it.sub}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
