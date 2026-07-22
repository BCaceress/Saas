import type { ReactNode } from "react";
import { DollarSign, TrendingUp, ShoppingCart, AlertTriangle } from "lucide-react";
import { KpiCard } from "@/components/charts/kpi-card";
import { variacao } from "@/lib/periodo";
import { brl } from "@/lib/utils";
import type { ResumoVendas, PontoFinanceiro } from "../relatorios/_data";
import type { RitmoPedidos } from "./_data";

/**
 * Os 4 indicadores fixos do Centro de Operações (financeiro + operacional):
 * Receita, Lucro Bruto, Pedidos em andamento, Produtos em ruptura. Cada um com
 * tooltip explicando o indicador e uma leitura curta que só aparece no hover
 * (`iaHint`) — nunca ocupa espaço fixo na tela.
 *
 * A miniatura de cada card segue o tipo do dado (ver KpiChart): dinheiro por
 * dia = área, contagem por dia = barras, parte do total = medidor.
 *
 * Mobile: vira carrossel com scroll-snap (os 4 cards não cabem em 2 colunas
 * sem apertar); em `sm:` volta a virar grid normal.
 */
export function KpiRow({
  resumo,
  resumoPrev,
  serie,
  rupturaCount,
  totalItens,
  pedidosAndamentoCount,
  ritmo,
  hintFaturamento,
  hintPedido,
}: {
  resumo: ResumoVendas;
  resumoPrev: ResumoVendas;
  serie: PontoFinanceiro[];
  rupturaCount: number;
  totalItens: number;
  pedidosAndamentoCount: number;
  ritmo: RitmoPedidos;
  // ReactNode e não string: as leituras da IA dependem dos insights (a análise
  // mais cara da tela) e chegam por streaming, depois dos números.
  hintFaturamento?: ReactNode;
  hintPedido?: ReactNode;
}) {
  const pctRuptura = totalItens > 0 ? Math.round((rupturaCount / totalItens) * 100) : 0;

  const item = "min-w-[78%] shrink-0 snap-start sm:min-w-0 sm:shrink";

  return (
    <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4">
      <div className={item}>
        <KpiCard
          label="Receita"
          value={brl(resumo.faturamento)}
          delta={variacao(resumo.faturamento, resumoPrev.faturamento)}
          href="/relatorios/vendas"
          tooltip="Faturamento total de vendas pagas no período."
          icon={DollarSign}
          tone="brand"
          chart={{ tipo: "area", valores: serie.map((p) => p.receita) }}
          iaHint={hintFaturamento}
          destaque
        />
      </div>
      <div className={item}>
        <KpiCard
          label="Lucro bruto"
          value={brl(resumo.margemBruta)}
          delta={variacao(resumo.margemBruta, resumoPrev.margemBruta)}
          hint={`${Math.round(resumo.margemPct)}% da receita`}
          href="/relatorios/margem"
          tooltip="Receita menos o custo da mercadoria vendida (CMV)."
          icon={TrendingUp}
          tone="ok"
          chart={{ tipo: "area", valores: serie.map((p) => p.lucro) }}
        />
      </div>
      <div className={item}>
        <KpiCard
          label="Pedidos em andamento"
          value={String(pedidosAndamentoCount)}
          delta={ritmo.anterior > 0 || ritmo.atual > 0 ? variacao(ritmo.atual, ritmo.anterior) : null}
          hint="enviados, aguardando ou em trânsito"
          href="/compras"
          tooltip="Pedidos de compra ainda não recebidos por completo."
          icon={ShoppingCart}
          tone="info"
          chart={{ tipo: "barras", valores: ritmo.porDia }}
          iaHint={hintPedido}
        />
      </div>
      <div className={item}>
        <KpiCard
          label="Produtos em ruptura"
          value={String(rupturaCount)}
          hint={totalItens > 0 ? `${pctRuptura}% do estoque monitorado` : "abaixo do mínimo"}
          goodWhen="down"
          href="/estoque?filtro=baixoMinimo"
          tooltip="Produtos com saldo abaixo do estoque mínimo, agora."
          icon={AlertTriangle}
          tone={rupturaCount > 0 ? "danger" : "ok"}
          // Ruptura não é série no tempo — é uma parte do estoque monitorado.
          // Como barras (o que era antes), lia-se como tendência inexistente.
          chart={totalItens > 0 ? { tipo: "medidor", parte: rupturaCount, total: totalItens } : undefined}
        />
      </div>
    </div>
  );
}
