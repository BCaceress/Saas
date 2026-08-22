"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TrendingUp, TrendingDown, TriangleAlert, Wallet, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Metrica, MetricaGrid } from "../../cotacoes/_catalogo/ui";
import { fmtMoney } from "../../cotacoes/_catalogo/format";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";
import type { FluxoCaixa } from "@/lib/financeiro/fluxo-caixa";

// ============================================================
// Fluxo de caixa projetado.
//
// A leitura é uma linha do tempo, não uma tabela de somas. O elemento central é
// a barra do dia: entrada acima da linha, saída abaixo, e o saldo acumulado
// correndo por cima. O dia em que o saldo cruza o zero é o que o operador
// precisa ver antes de qualquer número — é para isso que ele abriu a tela.
// ============================================================

const JANELAS = [15, 30, 60, 90];

const diaLabel = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

const diaSemana = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");

export function FluxoCaixaView({
  fluxo,
  dias,
  saldoInicial,
}: {
  fluxo: FluxoCaixa;
  dias: number;
  saldoInicial: number;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [saldoTexto, setSaldoTexto] = useState(saldoInicial ? String(saldoInicial) : "");
  const [aberto, setAberto] = useState<string | null>(null);

  function navegar(patch: { dias?: number; saldo?: string }) {
    const q = new URLSearchParams();
    q.set("dias", String(patch.dias ?? dias));
    const s = patch.saldo ?? saldoTexto;
    if (s) q.set("saldo", s);
    start(() => router.push(`/financeiro/fluxo-de-caixa?${q.toString()}`));
  }

  // Escala compartilhada entre entradas e saídas: barras com escalas próprias
  // fariam R$ 200 de entrada parecer do tamanho de R$ 2.000 de saída.
  const pico = Math.max(
    1,
    ...fluxo.dias.map((d) => Math.max(d.entradas, d.saidas)),
  );

  const comMovimento = fluxo.dias.filter((d) => d.entradas > 0 || d.saidas > 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Fluxo de caixa"
        icon={navIcon("/financeiro/fluxo-de-caixa")}
        description="O que entra e o que sai, por vencimento. Projeção — não é extrato bancário."
      />

      {fluxo.primeiroDiaNegativo && (
        <p className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong className="font-semibold">
              O caixa fica negativo em {diaLabel(fluxo.primeiroDiaNegativo)}
            </strong>{" "}
            — no pior dia da janela falta {fmtMoney(Math.abs(fluxo.menorSaldo))}. Antecipe
            recebimento, negocie prazo, ou ajuste o saldo inicial se ele estiver desatualizado.
          </span>
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-faint">
            Saldo em caixa hoje
          </label>
          <div className="flex items-center gap-2">
            <input
              value={saldoTexto}
              onChange={(e) => setSaldoTexto(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && navegar({})}
              inputMode="decimal"
              placeholder="0,00"
              className="w-40 rounded-[var(--radius)] border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
            <Button size="sm" variant="secondary" onClick={() => navegar({})}>
              Projetar
            </Button>
          </div>
          <p className="text-[11px] text-muted">
            O NoHub não conecta em banco: informe quanto há em conta para a projeção sair do lugar certo.
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {JANELAS.map((j) => (
            <button
              key={j}
              type="button"
              onClick={() => navegar({ dias: j })}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
                dias === j
                  ? "border-brand bg-brand text-on-brand"
                  : "border-line bg-surface text-ink-2 hover:bg-surface-2",
              )}
            >
              {j} dias
            </button>
          ))}
        </div>
      </div>

      <MetricaGrid className="sm:grid-cols-2 lg:grid-cols-4">
        <Metrica
          label="A receber"
          valor={fmtMoney(fluxo.totalEntradas)}
          sub={`nos próximos ${dias} dias`}
          tom="ok"
          icon={<TrendingUp size={12} />}
        />
        <Metrica
          label="A pagar"
          valor={fmtMoney(fluxo.totalSaidas)}
          sub={`nos próximos ${dias} dias`}
          tom="accent"
          icon={<TrendingDown size={12} />}
        />
        <Metrica
          label="Menor saldo"
          valor={fmtMoney(fluxo.menorSaldo)}
          sub={fluxo.menorSaldo < 0 ? "o caixa não fecha" : "folga no pior dia"}
          tom={fluxo.menorSaldo < 0 ? "accent" : "ink"}
          icon={<Wallet size={12} />}
        />
        <Metrica
          label="Saldo ao fim"
          valor={fmtMoney(fluxo.saldoFinal)}
          sub={`partindo de ${fmtMoney(fluxo.saldoInicial)}`}
          tom={fluxo.saldoFinal < 0 ? "accent" : "ok"}
        />
      </MetricaGrid>

      {comMovimento.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-line bg-surface px-6 py-12 text-center text-sm text-muted">
          Nenhum vencimento nos próximos {dias} dias. Quando uma nota de entrada for recebida ou um
          título a receber for lançado, ele aparece aqui.
        </p>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          <ul className="divide-y divide-line">
            {comMovimento.map((d) => {
              const expandido = aberto === d.data;
              return (
                <li key={d.data}>
                  <button
                    type="button"
                    onClick={() => setAberto(expandido ? null : d.data)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <span className="w-16 shrink-0">
                      <span className="block font-mono text-[13px] font-semibold text-ink">
                        {diaLabel(d.data)}
                      </span>
                      <span className="block text-[10px] uppercase text-faint">
                        {diaSemana(d.data)}
                      </span>
                    </span>

                    {/* Barra dupla: entrada para a direita, saída para a
                        esquerda, mesma escala. A forma diz o resultado do dia
                        antes de qualquer número ser lido. */}
                    <span className="flex min-w-0 flex-1 items-center gap-1">
                      <span className="flex h-5 flex-1 items-center justify-end">
                        {d.saidas > 0 && (
                          <span
                            className="h-3.5 rounded-l-full bg-accent"
                            style={{ width: `${(d.saidas / pico) * 100}%` }}
                          />
                        )}
                      </span>
                      <span className="h-5 w-px shrink-0 bg-line" />
                      <span className="flex h-5 flex-1 items-center">
                        {d.entradas > 0 && (
                          <span
                            className="h-3.5 rounded-r-full bg-ok"
                            style={{ width: `${(d.entradas / pico) * 100}%` }}
                          />
                        )}
                      </span>
                    </span>

                    <span className="w-28 shrink-0 text-right">
                      <span
                        className={cn(
                          "block font-display text-[14px] font-semibold",
                          d.saldo < 0 ? "text-danger" : "text-ink",
                        )}
                      >
                        {fmtMoney(d.saldo)}
                      </span>
                      <span className="block text-[10px] text-muted">saldo</span>
                    </span>

                    <ChevronRight
                      size={15}
                      className={cn(
                        "shrink-0 text-faint transition-transform",
                        expandido && "rotate-90",
                      )}
                    />
                  </button>

                  {expandido && (
                    <ul className="divide-y divide-line border-t border-line bg-surface-2">
                      {d.itens.map((i, idx) => (
                        <li
                          key={`${d.data}-${idx}`}
                          className="flex items-center gap-3 px-4 py-2 pl-20"
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 shrink-0 rounded-full",
                              i.tipo === "entrada" ? "bg-ok" : "bg-accent",
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                            {i.descricao}
                            {i.vencido && (
                              <span className="ml-2 text-[11px] font-medium text-danger">
                                vencido
                              </span>
                            )}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 font-mono text-[13px]",
                              i.tipo === "entrada" ? "text-ok" : "text-accent",
                            )}
                          >
                            {i.tipo === "entrada" ? "+" : "−"}
                            {fmtMoney(i.valor)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted">
        Vencido entra no primeiro dia da janela — dívida atrasada não some por estar atrasada.{" "}
        <Link href="/financeiro/contas-a-pagar?status=VENCIDO" className="text-brand hover:underline">
          Ver o que está vencido
        </Link>
        .
      </p>
    </div>
  );
}
