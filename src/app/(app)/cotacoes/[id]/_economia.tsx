"use client";

import Link from "next/link";
import { TrendingDown, TrendingUp, PackageCheck, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { fmtMoney } from "../_ui";
import type { EconomiaCotacao } from "@/lib/compras/cotacao-economia";

// ============================================================
// O que a cotação economizou — e o que o fornecedor cobrou de verdade.
//
// A cotação virava pedido e a história acabava ali. Duas perguntas ficavam sem
// resposta: valeu a pena cotar, e quem ganhou cumpriu o preço? A segunda é a
// que muda a próxima cotação — fornecedor que ganha por centavos e fatura mais
// caro não aparece em lugar nenhum até alguém somar as duas colunas.
// ============================================================

const STATUS_LABEL: Record<string, string> = {
  RASCUNHO: "Rascunho",
  ENVIADO: "Enviado",
  AGUARDANDO: "Confirmado",
  EM_TRANSITO: "Em trânsito",
  CONFERENCIA: "Em conferência",
  RECEBIDO_PARCIAL: "Recebido em parte",
  RECEBIDO: "Recebido",
  CANCELADO: "Cancelado",
};

export function EconomiaCotacaoPainel({ economia }: { economia: EconomiaCotacao }) {
  const { economiaEstimada, percentual, desvioFaturamento, valorRecebido } = economia;
  const houveEntrega = valorRecebido > 0;
  const cobrouMais = desvioFaturamento > 0.005;

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-[15px] font-semibold text-ink">Resultado da cotação</h3>
        {economia.itensComparados > 0 && (
          <span className="text-[11px] text-muted">
            {economia.itensComparados}{" "}
            {economia.itensComparados === 1 ? "item comparado" : "itens comparados"}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-[var(--radius)] border border-line sm:grid-cols-4 sm:divide-y-0">
        <Celula
          label="Escolhido"
          valor={fmtMoney(economia.valorEscolhido)}
          sub="preço cotado dos vencedores"
        />
        <Celula
          label="Pior preço"
          valor={fmtMoney(economia.valorPiorCaso)}
          sub="a mesma cesta, sem cotar"
        />
        <Celula
          label="Economia"
          valor={fmtMoney(economiaEstimada)}
          sub={percentual > 0 ? `${percentual.toFixed(1)}% sobre o pior preço` : "sem comparação"}
          tom={economiaEstimada > 0 ? "ok" : "ink"}
          icon={<TrendingDown size={12} />}
        />
        <Celula
          label={houveEntrega ? "Faturado" : "Pedido"}
          valor={fmtMoney(houveEntrega ? valorRecebido : economia.valorPedido)}
          sub={
            !houveEntrega
              ? "nada recebido ainda"
              : cobrouMais
                ? `${fmtMoney(desvioFaturamento)} acima do pedido`
                : desvioFaturamento < -0.005
                  ? `${fmtMoney(Math.abs(desvioFaturamento))} abaixo do pedido`
                  : "igual ao pedido"
          }
          tom={cobrouMais ? "accent" : "ink"}
          icon={cobrouMais ? <TrendingUp size={12} /> : <PackageCheck size={12} />}
        />
      </div>

      {cobrouMais && (
        <p className="rounded-[var(--radius)] border border-accent/40 bg-accent-soft px-3.5 py-2.5 text-xs text-accent">
          O que foi faturado ficou {fmtMoney(desvioFaturamento)} acima do que foi cotado. Vale
          conferir a nota antes de cotar com este fornecedor de novo — economia só existe se o
          preço da proposta chegar até o boleto.
        </p>
      )}

      {economia.pedidos.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {economia.pedidos.map((p) => (
            <li key={p.id}>
              <Link
                href={`/pedidos?pedido=${p.id}`}
                className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-line px-3.5 py-2.5 transition-colors hover:bg-surface-2"
              >
                <span className="min-w-0">
                  <span className="block text-sm text-ink">
                    <span className="font-mono text-[13px] font-semibold">{p.numero}</span>
                    <span className="ml-2 text-muted">{p.supplierNome}</span>
                  </span>
                  <span className="mt-0.5 inline-flex items-center gap-2">
                    <Badge>{STATUS_LABEL[p.status] ?? p.status}</Badge>
                    {p.valorRecebido > 0 && (
                      <span className="text-[11px] text-muted">
                        recebido {fmtMoney(p.valorRecebido)}
                      </span>
                    )}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 font-display text-sm font-semibold text-ink">
                  {fmtMoney(p.valorTotal)}
                  <ArrowUpRight size={14} className="text-muted" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Celula({
  label,
  valor,
  sub,
  tom = "ink",
  icon,
}: {
  label: string;
  valor: string;
  sub: string;
  tom?: "ink" | "ok" | "accent";
  icon?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={cn(
          "mt-1 truncate font-display text-[17px] font-semibold leading-tight",
          tom === "ok" ? "text-ok" : tom === "accent" ? "text-accent" : "text-ink",
        )}
      >
        {valor}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-muted">{sub}</div>
    </div>
  );
}
