"use client";

import Link from "next/link";
import { ClipboardList, PackageCheck, PackageX, TriangleAlert, Truck, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney } from "../cotacoes/_ui";
import type { ResumoPedidos } from "../estoque/_data";

// ── Resumo da operação ────────────────────────────────────────
//
// Um bloco com divisores, não cinco cards soltos. Cinco caixas com borda
// própria criam dez linhas verticais onde deveriam existir quatro, e a faixa
// briga com a tabela logo abaixo em vez de servir de cabeçalho para ela. É o
// mesmo desenho de `MetricaGrid`, que o resto do app já usa.
//
// Os números são do TENANT, não da página: cinco totais que mudam a cada
// filtro não são resumo. O operador leria "3 atrasados" achando que são todos.

type Item = {
  icon: React.ElementType;
  label: string;
  valor: string;
  sub?: string;
  tom?: "accent" | "danger";
  href?: string;
};

export function PurchaseOrderSummary({ resumo }: { resumo: ResumoPedidos }) {
  const plural = (n: number, um: string, muitos: string) => (n === 1 ? um : muitos);

  const items: Item[] = [
    {
      icon: ClipboardList,
      label: "Pedidos ativos",
      valor: String(resumo.ativos),
      sub: "do rascunho ao recebimento",
    },
    {
      icon: PackageCheck,
      label: "Aguardando recebimento",
      valor: String(resumo.aguardandoRecebimento),
      sub: plural(resumo.aguardandoRecebimento, "pedido na porta", "pedidos na porta"),
    },
    {
      icon: Wallet,
      label: "Ainda não chegou",
      valor: fmtMoney(resumo.valorSaldo),
      // O rótulo diz o que o número É. "Valor em aberto" contava mercadoria de
      // pedido parcial que já está na prateleira.
      sub: "mercadoria que falta entrar",
    },
    {
      icon: Truck,
      label: "Entrega hoje",
      valor: String(resumo.entregaHoje),
      sub: plural(resumo.entregaHoje, "pedido previsto", "pedidos previstos"),
    },
    {
      icon: TriangleAlert,
      label: "Atrasados",
      valor: String(resumo.atrasados),
      sub: "passaram da previsão",
      tom: resumo.atrasados > 0 ? "danger" : undefined,
    },
    {
      icon: PackageX,
      label: "Saldo sem decisão",
      valor: String(resumo.saldoPendente),
      sub: resumo.saldoPendente > 0 ? "o resto vem?" : "nenhum pendente",
      tom: resumo.saldoPendente > 0 ? "accent" : undefined,
      href: resumo.saldoPendente > 0 ? "/pedidos?status=saldo&periodo=" : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
      {items.map((it) => {
        const conteudo = (
          <>
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">
              <it.icon size={12} className={cn(it.tom === "danger" && "text-danger", it.tom === "accent" && "text-accent")} />
              <span className="truncate">{it.label}</span>
            </div>
            <div
              className={cn(
                "mt-1 truncate font-display text-[19px] font-semibold leading-tight tabular-nums",
                it.tom === "danger" ? "text-danger" : it.tom === "accent" ? "text-accent" : "text-ink",
              )}
            >
              {it.valor}
            </div>
            {it.sub && <div className="mt-0.5 truncate text-[12px] text-muted">{it.sub}</div>}
          </>
        );

        // Métrica que aponta para uma pendência vira atalho — o número diz que
        // há trabalho, e o clique leva direto a ele.
        return it.href ? (
          <Link
            key={it.label}
            href={it.href}
            className="min-w-0 px-4 py-3.5 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:ring-inset"
          >
            {conteudo}
          </Link>
        ) : (
          <div key={it.label} className="min-w-0 px-4 py-3.5">
            {conteudo}
          </div>
        );
      })}
    </div>
  );
}
