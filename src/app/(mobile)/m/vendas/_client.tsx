"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, Receipt, Users } from "lucide-react";
import { brl, cn } from "@/lib/utils";
import { Badge, Card } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { metodoLabel, origemLabel } from "@/lib/pagamento-labels";
import {
  pollAutoatendimentoAction,
  confirmarPagamentoTotemAction,
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
}: {
  resumo: ResumoVendas;
  mix: MixPagamento[];
  porHora: PontoTempo[];
  recentes: VendaRow[];
  siteId: string | null;
  autoatendimento: boolean;
  podeRegistrar: boolean;
}) {
  return (
    <div className="space-y-5">
      {/* Bloco único com divisor: as duas medidas se leem juntas ("quanto
          entrou" × "de quantas vendas"), não como cartões soltos. */}
      <Card className="grid grid-cols-2 divide-x divide-line">
        <Tile label="Receita" valor={brl(resumo.faturamento)} />
        <Tile label="Vendas" valor={String(resumo.numVendas)} nota={`ticket ${brl(resumo.ticket)}`} />
      </Card>

      <CurvaPorHora pontos={porHora} />

      {mix.length > 0 && <Mix mix={mix} total={resumo.faturamento} />}

      {autoatendimento && podeRegistrar && siteId && <FilaTotem siteId={siteId} />}

      <Recentes vendas={recentes} />
    </div>
  );
}

function Tile({ label, valor, nota }: { label: string; valor: string; nota?: string }) {
  return (
    <div className="p-4">
      <p className="text-xs text-ink-2">{label}</p>
      <p className="mt-1 font-display text-2xl leading-none font-semibold text-ink">{valor}</p>
      {nota && <p className="mt-1 text-[11px] text-muted">{nota}</p>}
    </div>
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

/**
 * Últimas vendas — consulta, não operação.
 *
 * Sem cancelar: estornar uma venda mexe em estoque, caixa e fiscal, e a
 * conferência disso é de balcão. No celular a linha só ABRE, mostrando o que foi
 * vendido — que é a pergunta real de quem confere ("essa de R$ 40 foi o quê?").
 * O cancelamento continua no PDV, onde a gaveta está.
 */
function Recentes({ vendas }: { vendas: VendaRow[] }) {
  const [aberta, setAberta] = React.useState<string | null>(null);

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
        {vendas.map((v) => {
          const expandida = aberta === v.id;
          const quando = v.paidAt ?? v.createdAt;
          return (
            <div key={v.id}>
              <button
                type="button"
                onClick={() => setAberta(expandida ? null : v.id)}
                aria-expanded={expandida}
                className="flex w-full cursor-pointer items-center gap-3 p-3 text-left transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] focus-visible:outline-none"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{brl(v.total)}</p>
                  <p className="truncate text-xs text-muted">
                    {origemLabel(v.origem)} · {v.numItens}{" "}
                    {v.numItens === 1 ? "item" : "itens"}
                    {v.metodos.length > 0 && ` · ${v.metodos.map(metodoLabel).join(", ")}`}
                  </p>
                </div>

                <span className="min-w-0 shrink-0 text-right">
                  {/* O comprador só aparece quando existe cadastro — inventar
                      "Consumidor" para a venda de balcão seria ruído. */}
                  {v.cliente && (
                    <span className="block max-w-32 truncate text-xs font-medium text-ink">
                      {v.cliente}
                    </span>
                  )}
                  <span className="block text-xs text-muted tabular-nums">
                    {quando.toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                    })}{" "}
                    {quando.toLocaleTimeString("pt-BR", {
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

                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-faint transition-transform",
                    expandida && "rotate-180",
                  )}
                  aria-hidden
                />
              </button>

              {expandida && (
                <ul className="space-y-1.5 border-t border-line bg-surface-2 px-3 py-2.5">
                  {v.itens.length === 0 ? (
                    <li className="text-xs text-muted">Venda sem itens registrados.</li>
                  ) : (
                    v.itens.map((i, idx) => (
                      <li key={idx} className="flex items-baseline gap-2 text-[13px]">
                        <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
                          {i.quantidade.toLocaleString("pt-BR", {
                            maximumFractionDigits: 3,
                          })}
                          ×
                        </span>
                        <span className="min-w-0 flex-1 truncate text-ink">{i.nome}</span>
                        <span className="shrink-0 font-medium text-ink-2 tabular-nums">
                          {brl(i.total)}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </Card>
    </section>
  );
}
