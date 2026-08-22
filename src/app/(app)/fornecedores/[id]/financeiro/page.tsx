import Link from "next/link";
import {
  Wallet,
  CalendarRange,
  ClipboardList,
  Receipt,
  CreditCard,
  Truck,
  PiggyBank,
  Timer,
  TrendingUp,
} from "lucide-react";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { LineChart } from "@/components/charts/line-chart";
import { Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { loadFinanceiroFornecedor } from "../_data";
import { EstadoVazio, Metrica, MetricaGrid } from "../../../cotacoes/_catalogo/ui";
import { fmtMoney } from "../../../cotacoes/_catalogo/format";

// Aba Financeiro — o peso deste fornecedor no bolso da loja. Só números
// deste parceiro; o consolidado de compras vive em Relatórios.

export default async function FinanceiroFornecedorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireActiveTenant();
  const { id } = await params;
  const f = await withTenant(ctx, () => loadFinanceiroFornecedor(id));

  if (f.pedidosTotal === 0) {
    return (
      <EstadoVazio
        icon={<Wallet size={20} />}
        titulo="Ainda não há histórico financeiro"
        descricao="Os indicadores nascem do primeiro pedido fechado com este fornecedor."
        acao={
          <Link href="/cotacoes">
            <Button size="sm" variant="secondary">
              Abrir compras
            </Button>
          </Link>
        }
      />
    );
  }

  const pontualidade =
    f.entregasComPrevisao > 0
      ? Math.round((f.entregasNoPrazo / f.entregasComPrevisao) * 100)
      : null;

  const serie = f.serieMensal.map((m) => ({ data: m.mes, valor: m.valor }));
  const temSerie = serie.some((s) => s.valor > 0);

  return (
    <div className="flex flex-col gap-4">
      <MetricaGrid className="lg:grid-cols-4">
        <Metrica
          label="Comprado este mês"
          valor={fmtMoney(f.compradoMes)}
          sub={`${f.pedidosMes} pedido${f.pedidosMes === 1 ? "" : "s"}`}
          icon={<Wallet size={12} />}
        />
        <Metrica
          label="Comprado este ano"
          valor={fmtMoney(f.compradoAno)}
          sub={`${f.pedidosAno} pedido${f.pedidosAno === 1 ? "" : "s"}`}
          icon={<CalendarRange size={12} />}
        />
        <Metrica
          label="Pedidos no total"
          valor={String(f.pedidosTotal)}
          sub={f.emAberto > 0 ? `${f.emAberto} em aberto` : "nenhum em aberto"}
          tom={f.emAberto > 0 ? "accent" : "ink"}
          icon={<ClipboardList size={12} />}
        />
        <Metrica
          label="Ticket médio"
          valor={fmtMoney(f.ticketMedio)}
          sub="por pedido"
          icon={<Receipt size={12} />}
        />
      </MetricaGrid>

      <MetricaGrid className="lg:grid-cols-4">
        <Metrica
          label="Prazo de pagamento"
          valor={f.prazoPagamentoDias != null ? `${f.prazoPagamentoDias} dias` : "—"}
          sub={f.prazoPagamentoDias != null ? "negociado" : "informe no Resumo"}
          icon={<CreditCard size={12} />}
        />
        <Metrica
          label="Prazo médio de entrega"
          valor={f.prazoEntregaDias != null ? `${f.prazoEntregaDias} dias` : "—"}
          sub={
            pontualidade != null
              ? `${pontualidade}% no prazo`
              : "sem entrega concluída com previsão"
          }
          tom={pontualidade != null && pontualidade < 70 ? "accent" : "ink"}
          icon={<Truck size={12} />}
        />
        <Metrica
          label="Economia obtida"
          valor={fmtMoney(f.economia)}
          sub={
            f.itensComparados > 0
              ? `${f.itensMaisBaratos} de ${f.itensComparados} itens mais baratos`
              : "sem item comparável"
          }
          tom={f.economia >= 0 ? "ok" : "accent"}
          icon={<PiggyBank size={12} />}
        />
        <Metrica
          label="Em aberto"
          valor={fmtMoney(f.valorEmAberto)}
          sub={`${f.emAberto} pedido${f.emAberto === 1 ? "" : "s"} a caminho`}
          icon={<Timer size={12} />}
        />
      </MetricaGrid>

      {/* Exposição: quanto se deve HOJE a este parceiro, e se a loja tem
          cumprido o prazo que negociou. Volume de compra não responde nem uma
          coisa nem outra — e é o fornecedor quem sente a diferença. */}
      {(f.titulosAbertos > 0 || f.titulosPagos > 0) && (
        <MetricaGrid className="lg:grid-cols-3">
          <Metrica
            label="Devendo agora"
            valor={fmtMoney(f.devendo)}
            sub={`${f.titulosAbertos} título${f.titulosAbertos === 1 ? "" : "s"} em aberto`}
            tom={f.devendo > 0 ? "accent" : "ink"}
            icon={<Wallet size={12} />}
          />
          <Metrica
            label="Vencido"
            valor={fmtMoney(f.devendoVencido)}
            sub={
              f.titulosVencidos > 0
                ? `${f.titulosVencidos} título${f.titulosVencidos === 1 ? "" : "s"} atrasado${f.titulosVencidos === 1 ? "" : "s"}`
                : "nada atrasado"
            }
            tom={f.devendoVencido > 0 ? "accent" : "ok"}
            icon={<Timer size={12} />}
          />
          <Metrica
            label="Pagamento praticado"
            valor={
              f.atrasoMedioDias == null
                ? "—"
                : f.atrasoMedioDias > 0.5
                  ? `${f.atrasoMedioDias} dias após`
                  : f.atrasoMedioDias < -0.5
                    ? `${Math.abs(f.atrasoMedioDias)} dias antes`
                    : "no dia"
            }
            sub={
              f.titulosPagos > 0
                ? `média de ${f.titulosPagos} título${f.titulosPagos === 1 ? "" : "s"} quitado${f.titulosPagos === 1 ? "" : "s"}`
                : "nenhum título quitado ainda"
            }
            tom={f.atrasoMedioDias != null && f.atrasoMedioDias > 3 ? "accent" : "ok"}
            icon={<CreditCard size={12} />}
          />
        </MetricaGrid>
      )}

      <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-[15px] font-semibold text-ink">Compras por mês</h2>
            <p className="text-[12px] text-muted">Últimos 12 meses, valor dos pedidos não cancelados.</p>
          </div>
          {f.economia !== 0 && (
            <Badge tone={f.economia > 0 ? "ok" : "danger"}>
              <TrendingUp size={11} />
              {f.economia > 0
                ? `${fmtMoney(f.economia)} abaixo do mercado`
                : `${fmtMoney(Math.abs(f.economia))} acima do mercado`}
            </Badge>
          )}
        </div>

        {temSerie ? (
          <LineChart pontos={serie} formato={fmtMoney} altura={220} />
        ) : (
          <p className="px-4 py-10 text-center text-[13px] text-muted">
            Nenhuma compra registrada nos últimos 12 meses.
          </p>
        )}
      </section>

      <p className="text-[12px] text-muted">
        &ldquo;Economia obtida&rdquo; compara o preço deste fornecedor com o melhor preço de mercado,
        item a item, no catálogo de hoje. Positivo = ele é a escolha mais barata.
      </p>
    </div>
  );
}
