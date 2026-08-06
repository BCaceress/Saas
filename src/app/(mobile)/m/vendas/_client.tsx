"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Monitor, Receipt, Users } from "lucide-react";
import { brl, cn } from "@/lib/utils";
import { Badge, Card } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { KpiCarousel, KpiSlide } from "@/components/mobile/kpi-carousel";
import { metodoLabel, origemLabel } from "@/lib/pagamento-labels";
import {
  pollAutoatendimentoAction,
  confirmarPagamentoTotemAction,
  cancelarVendaAction,
  type FilaAutoatendimento,
} from "@/app/(app)/vendas/actions";
import type { ResumoVendas, MixPagamento, PontoTempo } from "@/app/(app)/relatorios/_data";
import type { VendaRow } from "@/app/(app)/vendas/_data";

/** De quanto em quanto tempo a fila do autoatendimento é reconsultada. */
const POLL_MS = 8_000;

export function VendasClient({
  resumo,
  mix,
  porHora,
  recentes,
  siteId,
  autoatendimento,
  podeRegistrar,
  podeCancelar,
}: {
  resumo: ResumoVendas;
  mix: MixPagamento[];
  porHora: PontoTempo[];
  recentes: VendaRow[];
  siteId: string | null;
  autoatendimento: boolean;
  podeRegistrar: boolean;
  podeCancelar: boolean;
}) {
  return (
    <div className="space-y-5">
      <KpiCarousel>
        <KpiSlide>
          <Tile label="Receita" valor={brl(resumo.faturamento)} />
        </KpiSlide>
        <KpiSlide>
          <Tile label="Vendas" valor={String(resumo.numVendas)} nota={`ticket ${brl(resumo.ticket)}`} />
        </KpiSlide>
        <KpiSlide>
          <Tile
            label="Lucro bruto"
            valor={brl(resumo.margemBruta)}
            nota={`${Math.round(resumo.margemPct)}% da receita`}
          />
        </KpiSlide>
      </KpiCarousel>

      <CurvaPorHora pontos={porHora} />

      {mix.length > 0 && <Mix mix={mix} total={resumo.faturamento} />}

      {autoatendimento && podeRegistrar && siteId && <FilaTotem siteId={siteId} />}

      <Recentes vendas={recentes} podeCancelar={podeCancelar} />

      {/* O PDV não vem para o celular por decisão de escopo — dizer isso é
          melhor do que deixar a pessoa procurando o botão. */}
      {podeRegistrar && (
        <Link
          href="/vendas"
          className="flex min-h-12 items-center justify-center gap-2 rounded-full border border-line-button bg-surface text-sm font-medium text-ink"
        >
          <Monitor className="h-4 w-4" aria-hidden />
          Abrir o PDV no computador
        </Link>
      )}
    </div>
  );
}

function Tile({ label, valor, nota }: { label: string; valor: string; nota?: string }) {
  return (
    <Card className="h-full p-4">
      <p className="text-xs text-ink-2">{label}</p>
      <p className="mt-1 font-display text-2xl leading-none font-semibold text-ink">{valor}</p>
      {nota && <p className="mt-1 text-[11px] text-muted">{nota}</p>}
    </Card>
  );
}

/**
 * Curva por hora em barras puras de CSS. Não usa a biblioteca de gráficos do
 * desktop de propósito: aqui a leitura é "o movimento já veio?", que 24 barras
 * de 6px resolvem — e sem carregar o pacote de gráficos no 4G.
 */
function CurvaPorHora({ pontos }: { pontos: PontoTempo[] }) {
  const max = Math.max(...pontos.map((p) => p.valor), 0);
  if (max <= 0) {
    return (
      <Card className="p-4">
        <p className="text-sm font-medium text-ink">Movimento por hora</p>
        <p className="mt-1 text-[13px] text-muted">Nenhuma venda registrada hoje ainda.</p>
      </Card>
    );
  }

  const agora = new Date().getHours();

  return (
    <Card className="p-4">
      <p className="text-sm font-medium text-ink">Movimento por hora</p>
      <div className="mt-3 flex h-20 items-end gap-[3px]">
        {pontos.map((p) => {
          const hora = Number(p.data);
          const altura = Math.max(2, (p.valor / max) * 100);
          return (
            <div
              key={p.data}
              className="flex-1"
              title={`${p.data}h · ${brl(p.valor)}`}
              aria-label={`${p.data} horas: ${brl(p.valor)}`}
            >
              <div
                className={cn(
                  "w-full rounded-t-sm",
                  hora === agora ? "bg-brand" : "bg-brand/35",
                )}
                style={{ height: `${altura}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-faint">
        <span>{pontos[0]?.data ?? "0"}h</span>
        <span>{pontos[pontos.length - 1]?.data ?? "23"}h</span>
      </div>
    </Card>
  );
}

function Mix({ mix, total }: { mix: MixPagamento[]; total: number }) {
  const ordenado = [...mix].sort((a, b) => b.valor - a.valor);
  return (
    <Card className="p-4">
      <p className="text-sm font-medium text-ink">Como pagaram</p>
      <div className="mt-3 space-y-2">
        {ordenado.map((m) => {
          const pct = total > 0 ? (m.valor / total) * 100 : 0;
          return (
            <div key={m.metodo}>
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="text-ink">{metodoLabel(m.metodo)}</span>
                <span className="font-medium text-ink tabular-nums">{brl(m.valor)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/**
 * Fila do autoatendimento: clientes que montaram o carrinho no totem e vão
 * pagar no caixa. Consulta a cada 8 s — o operador precisa saber que tem
 * alguém esperando, e a tela costuma ficar aberta no balcão.
 */
function FilaTotem({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [fila, setFila] = React.useState<FilaAutoatendimento | null>(null);
  const [confirmando, setConfirmando] = React.useState<string | null>(null);

  React.useEffect(() => {
    let vivo = true;
    const buscar = () => {
      pollAutoatendimentoAction(siteId)
        .then((f) => vivo && setFila(f))
        .catch(() => {
          /* rede oscilou: tenta no próximo ciclo */
        });
    };
    buscar();
    const t = setInterval(buscar, POLL_MS);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [siteId]);

  if (!fila || fila.aguardando.length === 0) return null;

  async function receber(saleId: string) {
    setConfirmando(saleId);
    try {
      await confirmarPagamentoTotemAction(saleId);
      toast.success("Pagamento confirmado.");
      router.refresh();
    } catch (e) {
      toast.error(
        "Não foi possível confirmar",
        e instanceof Error ? e.message : "Tente pelo PDV.",
      );
    } finally {
      setConfirmando(null);
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-1.5 font-display text-base font-semibold text-ink">
        <Users className="h-4 w-4 text-brand" aria-hidden />
        Esperando no caixa
        <Badge tone="brand">{fila.aguardando.length}</Badge>
      </h2>
      <Card className="divide-y divide-line overflow-hidden">
        {fila.aguardando.map((v) => (
          <div key={v.id} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">
                <span className="font-mono">{v.numero}</span> · {brl(v.total)}
              </p>
              <p className="truncate text-xs text-muted">
                {v.numItens} {v.numItens === 1 ? "item" : "itens"}
                {v.terminal ? ` · ${v.terminal}` : ""}
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => receber(v.id)}
              disabled={confirmando === v.id}
            >
              {confirmando === v.id && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Recebi
            </Button>
          </div>
        ))}
      </Card>
    </section>
  );
}

function Recentes({
  vendas,
  podeCancelar,
}: {
  vendas: VendaRow[];
  podeCancelar: boolean;
}) {
  const router = useRouter();
  const [cancelando, setCancelando] = React.useState<string | null>(null);

  async function cancelar(id: string) {
    setCancelando(id);
    try {
      await cancelarVendaAction(id);
      toast.success("Venda cancelada.");
      router.refresh();
    } catch (e) {
      toast.error(
        "Não foi possível cancelar",
        e instanceof Error ? e.message : "Tente pelo PDV.",
      );
    } finally {
      setCancelando(null);
    }
  }

  if (vendas.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 p-6 text-center">
        <Receipt className="h-7 w-7 text-muted" aria-hidden />
        <p className="text-sm text-ink-2">Nenhuma venda registrada hoje.</p>
      </Card>
    );
  }

  return (
    <section className="space-y-2">
      <h2 className="font-display text-base font-semibold text-ink">Últimas vendas</h2>
      <Card className="divide-y divide-line overflow-hidden">
        {vendas.map((v) => (
          <div key={v.id} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{brl(v.total)}</p>
              <p className="truncate text-xs text-muted">
                {origemLabel(v.origem)} · {v.numItens}{" "}
                {v.numItens === 1 ? "item" : "itens"}
                {v.metodos.length > 0 && ` · ${v.metodos.map(metodoLabel).join(", ")}`}
              </p>
            </div>

            <span className="shrink-0 text-right">
              <span className="block text-xs text-muted tabular-nums">
                {(v.paidAt ?? v.createdAt).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              {v.status !== "PAGA" && (
                <Badge tone={v.status === "CANCELADA" ? "danger" : "warn"}>
                  {v.status === "CANCELADA" ? "Cancelada" : "Aberta"}
                </Badge>
              )}
            </span>

            {podeCancelar && v.status === "PAGA" && (
              <button
                type="button"
                onClick={() => cancelar(v.id)}
                disabled={cancelando === v.id}
                className="shrink-0 cursor-pointer rounded-full px-2 py-1 text-[11px] font-medium text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-50"
              >
                {cancelando === v.id ? "…" : "Cancelar"}
              </button>
            )}
          </div>
        ))}
      </Card>
    </section>
  );
}
