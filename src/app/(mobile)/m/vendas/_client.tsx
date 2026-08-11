"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, Check, ChevronDown, Loader2, Receipt, Users } from "lucide-react";
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
import { MAX_DIAS, PRESETS, paraInput, type PresetVendas } from "./_periodo";

/** De quanto em quanto tempo a fila do autoatendimento é reconsultada. */
const POLL_MS = 8_000;

export function VendasClient({
  resumo,
  mix,
  serie,
  granularidade,
  periodoLabel,
  incluiHoje,
  recentes,
  siteId,
  autoatendimento,
  podeRegistrar,
}: {
  resumo: ResumoVendas;
  mix: MixPagamento[];
  serie: PontoTempo[];
  granularidade: "hora" | "dia";
  periodoLabel: string;
  /** O período alcança o dia corrente — só aí a "hora de agora" existe. */
  incluiHoje: boolean;
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

      <CurvaMovimento
        pontos={serie}
        granularidade={granularidade}
        periodoLabel={periodoLabel}
        incluiHoje={incluiHoje}
      />

      {mix.length > 0 && <Mix mix={mix} total={resumo.faturamento} />}

      {autoatendimento && podeRegistrar && siteId && <FilaTotem siteId={siteId} />}

      <Recentes vendas={recentes} periodoLabel={periodoLabel} />
    </div>
  );
}

/* ── Seletor de período ───────────────────────────────────────── */

/**
 * Fica à direita do título e abre as opções PARA BAIXO — o polegar já está em
 * cima do cabeçalho quando a pergunta muda de "hoje" para "ontem", e uma folha
 * de baixo para cima cobriria justamente os números que se quer comparar.
 *
 * O intervalo próprio é o último item, não o primeiro: quatro em cada cinco
 * consultas são um dos presets. O teto de 30 dias aparece como limite dos
 * campos de data (o servidor apara de novo — a URL é editável).
 */
export function SeletorPeriodo({
  preset,
  label,
  de,
  ate,
}: {
  preset: PresetVendas;
  label: string;
  /** Início e fim do período atual, em YYYY-MM-DD — semente dos campos. */
  de: string;
  ate: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = React.useState(false);
  const [datas, setDatas] = React.useState(preset === "custom");
  const [inicio, setInicio] = React.useState(de);
  const [fim, setFim] = React.useState(ate);
  const caixa = React.useRef<HTMLDivElement>(null);
  // Trocar o período é uma viagem ao servidor (varre venda a venda, no 4G da
  // loja). Sem estado de espera, o toque some e a pessoa toca de novo.
  const [pendente, iniciar] = React.useTransition();
  const [emCurso, setEmCurso] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!aberto) return;
    function fora(e: PointerEvent) {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  // O menu NÃO fecha no toque: fechar já devolveria a tela antiga por um
  // segundo, que se lê como "não funcionou". Ele fica aberto mostrando a
  // rodinha e some sozinho quando os números novos chegam — a página monta o
  // seletor com `key` da busca, então a chegada remonta o componente.
  function ir(busca: string) {
    setEmCurso(busca);
    iniciar(() => {
      router.push(`/m/vendas?${busca}`);
    });
  }

  const hoje = paraInput(new Date());
  // Mínimo do "de" é 29 dias antes do "até" escolhido: o campo não deixa pedir
  // uma janela que o servidor iria aparar em silêncio.
  const minInicio = paraInput(
    new Date(new Date(`${fim || hoje}T00:00:00`).getTime() - (MAX_DIAS - 1) * 86_400_000),
  );

  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        className="tap inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border border-line-button bg-surface px-3.5 text-[13px] font-medium text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      >
        {label}
        {pendente ? (
          <Loader2 className="h-4 w-4 animate-spin text-brand" aria-hidden />
        ) : (
          <ChevronDown
            className={cn("h-4 w-4 text-muted transition-transform", aberto && "rotate-180")}
            aria-hidden
          />
        )}
      </button>

      {aberto && (
        <div
          role="menu"
          className="absolute top-full right-0 z-50 mt-2 w-64 overflow-hidden rounded-[var(--radius-m)] border border-line bg-surface shadow-[var(--shadow-2)]"
        >
          {PRESETS.map((p) => (
            <button
              key={p.valor}
              type="button"
              role="menuitem"
              onClick={() => ir(`p=${p.valor}`)}
              disabled={pendente}
              className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-4 text-left text-sm text-ink hover:bg-surface-2 disabled:cursor-default disabled:opacity-60"
            >
              <span className="flex-1">{p.label}</span>
              {emCurso === `p=${p.valor}` ? (
                <Loader2 className="h-4 w-4 animate-spin text-brand" aria-hidden />
              ) : (
                preset === p.valor && <Check className="h-4 w-4 text-brand" aria-hidden />
              )}
            </button>
          ))}

          <div className="border-t border-line">
            <button
              type="button"
              onClick={() => setDatas((v) => !v)}
              aria-expanded={datas}
              className="flex min-h-11 w-full cursor-pointer items-center gap-2 px-4 text-left text-sm text-ink hover:bg-surface-2"
            >
              <CalendarRange className="h-4 w-4 text-muted" aria-hidden />
              <span className="flex-1">Escolher datas</span>
              {preset === "custom" && <Check className="h-4 w-4 text-brand" aria-hidden />}
            </button>

            {datas && (
              <div className="space-y-2 border-t border-line bg-surface-2 p-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-muted">De</span>
                  <input
                    type="date"
                    value={inicio}
                    min={minInicio}
                    max={fim || hoje}
                    onChange={(e) => setInicio(e.target.value)}
                    className="min-h-10 w-full rounded-full border border-line-button bg-surface px-3 text-[13px] text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-muted">Até</span>
                  <input
                    type="date"
                    value={fim}
                    min={inicio}
                    max={hoje}
                    onChange={(e) => setFim(e.target.value)}
                    className="min-h-10 w-full rounded-full border border-line-button bg-surface px-3 text-[13px] text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                  />
                </label>
                <p className="text-[11px] text-muted">Máximo de {MAX_DIAS} dias.</p>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={!inicio || pendente}
                  onClick={() => ir(`p=custom&de=${inicio}&ate=${fim || hoje}`)}
                >
                  {pendente && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {pendente ? "Carregando…" : "Aplicar"}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
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
 * Curva do movimento em barras puras de CSS. Não usa a biblioteca de gráficos
 * do desktop de propósito: aqui a leitura é "o movimento já veio?", que barras
 * de 6px resolvem — e sem carregar o pacote de gráficos no 4G.
 *
 * Duas granularidades, mesma forma: um dia se lê hora a hora, vários dias se
 * leem dia a dia. Quem decide é a página, pelo tamanho do período.
 *
 * Os rótulos vêm PRONTOS do servidor — `vendasPorHora` devolve "08h" e
 * `vendasPorDia` devolve "2026-08-11". A barra em destaque (a hora corrente, o
 * último dia) sai da posição no vetor, não de reinterpretar esse texto: era
 * daí que vinham o "08hh" no rótulo e o destaque que nunca acendia.
 */
function CurvaMovimento({
  pontos,
  granularidade,
  periodoLabel,
  incluiHoje,
}: {
  pontos: PontoTempo[];
  granularidade: "hora" | "dia";
  periodoLabel: string;
  incluiHoje: boolean;
}) {
  const titulo = granularidade === "hora" ? "Movimento por hora" : "Movimento por dia";
  const max = Math.max(...pontos.map((p) => p.valor), 0);

  if (max <= 0) {
    return (
      <Card className="p-4">
        <p className="text-sm font-medium text-ink">{titulo}</p>
        <p className="mt-1 text-[13px] text-muted">
          Nenhuma venda registrada em {periodoLabel.toLowerCase()}.
        </p>
      </Card>
    );
  }

  // Na curva por hora, o "agora" só faz sentido quando o período inclui o dia
  // de hoje — e aí ele é o índice da hora corrente. Na curva por dia, o
  // destaque é sempre o último ponto (o dia mais recente do período).
  const destaque =
    granularidade === "hora"
      ? incluiHoje
        ? pontos.findIndex((p) => p.data === `${String(new Date().getHours()).padStart(2, "0")}h`)
        : -1
      : pontos.length - 1;

  const rotulo = (p: PontoTempo) =>
    granularidade === "hora" ? p.data : diaCurto(p.data);

  return (
    <Card className="p-4">
      <p className="text-sm font-medium text-ink">{titulo}</p>
      {/* Cada coluna precisa OCUPAR a altura da faixa: a barra tem altura em
          porcentagem, e porcentagem sobre pai de altura automática vira zero —
          era por isso que o gráfico saía em branco. Daí `items-stretch`
          (herdado) + `flex-col justify-end` para a barra crescer do chão. */}
      <div className="mt-3 flex h-20 gap-[3px]">
        {pontos.map((p, i) => {
          const altura = Math.max(2, (p.valor / max) * 100);
          return (
            <div
              key={p.data}
              className="flex flex-1 flex-col justify-end"
              title={`${rotulo(p)} · ${brl(p.valor)}`}
              aria-label={`${rotulo(p)}: ${brl(p.valor)}`}
            >
              <div
                className={cn("w-full rounded-t-sm", i === destaque ? "bg-brand" : "bg-brand/35")}
                style={{ height: `${altura}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-faint">
        <span>{pontos[0] ? rotulo(pontos[0]) : ""}</span>
        <span>{pontos.length > 1 ? rotulo(pontos[pontos.length - 1]!) : ""}</span>
      </div>
    </Card>
  );
}

/** "2026-08-11" → "11/08". A chave de `vendasPorDia` já é local, então corta
 *  direto o texto: `new Date("2026-08-11")` seria lido como UTC e voltaria um
 *  dia em quem está a oeste de Greenwich. */
function diaCurto(chave: string): string {
  const [, mes, dia] = chave.split("-");
  return mes && dia ? `${dia}/${mes}` : chave;
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
function Recentes({ vendas, periodoLabel }: { vendas: VendaRow[]; periodoLabel: string }) {
  const [aberta, setAberta] = React.useState<string | null>(null);

  if (vendas.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 p-6 text-center">
        <Receipt className="h-7 w-7 text-muted" aria-hidden />
        <p className="text-sm text-ink-2">
          Nenhuma venda registrada em {periodoLabel.toLowerCase()}.
        </p>
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
