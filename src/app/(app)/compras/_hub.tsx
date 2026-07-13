"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  ChevronRight,
  CircleCheck,
  PackageCheck,
  PartyPopper,
  Pencil,
  Truck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import type { GrupoReposicao, SugestaoRow } from "./_data";
import { PedidoDrawer, PedidoFormSheet, type FormOptions, type PedidoView } from "./_pedidos";
import { PedidoReceber, TransferReceber, type Transfer } from "./_recebimentos";
import { eventoMeta, eventoStatusLabel, type Evento } from "./_historico";
import { estadoEntrega, fmtMoney, fmtQtd, previsaoLabel, relDia, StatusDot, Thumb, PEDIDO_STATUS, STATUS_REPO } from "./_ui";

// ── Inbox operacional de Compras ──────────────────────────────
// Sem abas: a tela responde "o que precisa da minha atenção agora?"
// em três blocos verticais — Reposição (a decisão), Em andamento
// (processos vivos) e Últimas atividades (contexto recente).

const ATIVOS = ["RASCUNHO", "ENVIADO", "AGUARDANDO", "RECEBIDO_PARCIAL"];

export function ComprasInbox({
  grupos,
  pedidos,
  transferencias,
  eventos,
  formOptions,
  empresa,
  initialQuery,
}: {
  grupos: GrupoReposicao[];
  pedidos: PedidoView[];
  transferencias: Transfer[];
  eventos: Evento[];
  formOptions: FormOptions;
  empresa: string;
  initialQuery?: string;
}) {
  const [detalhe, setDetalhe] = useState<PedidoView | null>(null);
  const [receber, setReceber] = useState<PedidoView | null>(null);
  const [receberTransfer, setReceberTransfer] = useState<Transfer | null>(null);
  const [editar, setEditar] = useState<PedidoView | null>(null);
  // Filtro vindo de links externos (ex.: Fornecedores → "ver pedidos").
  const [filtro, setFiltro] = useState(initialQuery?.trim() ?? "");

  // ── Situação em números ──
  const stats = useMemo(() => {
    let urgentes = 0;
    let repor = 0;
    let estimado = 0;
    for (const g of grupos) {
      for (const it of g.itens) {
        if (it.qtdSugerida <= 0) continue;
        if (it.status === "abaixo") repor += 1;
        else urgentes += 1;
        estimado += it.qtdSugerida * (it.custoUnitCompra ?? 0);
      }
    }
    const aCaminho =
      pedidos.filter((p) => ["ENVIADO", "AGUARDANDO", "RECEBIDO_PARCIAL"].includes(p.status)).length +
      transferencias.length;
    return { urgentes, repor, aCaminho, estimado };
  }, [grupos, pedidos, transferencias]);

  // ── Em andamento: ordenado pela próxima ação, não pelo status ──
  const andamento = useMemo(() => {
    const termo = filtro.toLowerCase();
    const base = filtro
      ? pedidos.filter((p) => `${p.numero} ${p.supplierNome} ${p.siteNome}`.toLowerCase().includes(termo))
      : pedidos.filter((p) => ATIVOS.includes(p.status));
    const itens: AndamentoItem[] = base.map((p) => ({ tipo: "pedido" as const, pedido: p, ...acaoPedido(p) }));
    if (!filtro) {
      for (const t of transferencias) itens.push({ tipo: "transferencia", transfer: t, peso: 2 });
    }
    return itens.sort(
      (a, b) =>
        a.peso - b.peso ||
        (prevOrd(a) ?? Infinity) - (prevOrd(b) ?? Infinity),
    );
  }, [pedidos, transferencias, filtro]);

  const totalReposicao = stats.urgentes + stats.repor;

  return (
    <div className="flex flex-col gap-6">
      {filtro && (
        <div className="flex items-center gap-2 text-sm text-muted">
          Mostrando pedidos com <span className="font-medium text-ink">“{filtro}”</span>
          <button
            type="button"
            onClick={() => setFiltro("")}
            className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X size={12} /> Limpar
          </button>
        </div>
      )}

      {/* ── Reposição: o foco da tela ── */}
      {!filtro && <ReposicaoBloco grupos={grupos} total={totalReposicao} urgentes={stats.urgentes} estimado={stats.estimado} />}

      {/* ── Em andamento ── */}
      <section className="flex flex-col gap-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-faint">
          {filtro ? "Pedidos encontrados" : "Pedidos enviados ou a caminho"}
        </h2>
        {andamento.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
            {filtro ? "Nenhum pedido com esse termo." : "Nenhum pedido em andamento — os pedidos criados aparecem aqui até a entrada no estoque."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {andamento.map((a) =>
              a.tipo === "pedido" ? (
                <PedidoCardRow
                  key={a.pedido.id}
                  pedido={a.pedido}
                  cta={a.cta}
                  ctaPrimaria={a.primaria}
                  onAbrir={() => setDetalhe(a.pedido)}
                  onCta={() => (a.acao === "receber" ? setReceber(a.pedido) : setDetalhe(a.pedido))}
                />
              ) : (
                <TransferCardRow key={a.transfer.id} transfer={a.transfer} onReceber={() => setReceberTransfer(a.transfer)} />
              ),
            )}
          </ul>
        )}
      </section>

      {/* ── Últimas atividades ── */}
      {!filtro && eventos.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-faint">Últimas atividades</h2>
          <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface shadow-(--shadow-1)">
            {eventos.slice(0, 3).map((e) => {
              const meta = eventoMeta(e);
              const pendente = e.origem === "PEDIDO";
              return (
                <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", pendente ? meta.cls : "bg-ok-soft text-ok")}>
                    {pendente ? <meta.icon size={15} /> : <CircleCheck size={15} />}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm text-ink-2">
                    <span className="font-medium text-ink">{e.titulo}</span>
                    {e.subtitulo && <span className="text-muted"> · {e.subtitulo}</span>}
                    <span className={cn("ml-1.5 rounded-full px-1.5 py-px align-middle text-[10px] font-semibold", pendente ? meta.cls : "bg-ok-soft text-ok")}>
                      {eventoStatusLabel(e)}
                    </span>
                    <span className="text-faint"> · {relDia(e.data)}</span>
                  </p>
                  {e.valor != null && <span className="shrink-0 text-sm font-medium tabular-nums text-ink">{fmtMoney(e.valor)}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── Sobreposições ── */}
      <PedidoDrawer
        pedido={detalhe}
        empresa={empresa}
        onClose={() => setDetalhe(null)}
        onEditar={(p) => {
          setDetalhe(null);
          setEditar(p);
        }}
        onReceber={(p) => {
          setDetalhe(null);
          setReceber(p);
        }}
      />

      {editar && (
        <PedidoFormSheet
          open
          onClose={() => setEditar(null)}
          mode="editar"
          pedido={editar}
          formOptions={formOptions}
          empresa={empresa}
          onDone={() => setEditar(null)}
        />
      )}

      <Sheet
        open={receber !== null}
        onClose={() => setReceber(null)}
        title={receber ? `Receber ${receber.numero}` : ""}
        description={receber ? `${receber.supplierNome} · confira o que chegou para gerar a entrada no estoque.` : ""}
        width="2xl"
      >
        {receber && <PedidoReceber pedido={receber} onDone={() => setReceber(null)} />}
      </Sheet>

      <Sheet
        open={receberTransfer !== null}
        onClose={() => setReceberTransfer(null)}
        title="Receber transferência"
        description={receberTransfer ? `De ${receberTransfer.origemNome} — confira as quantidades recebidas.` : ""}
        width="xl"
      >
        {receberTransfer && <TransferReceber transfer={receberTransfer} onDone={() => setReceberTransfer(null)} />}
      </Sheet>
    </div>
  );
}

// ── Bloco Reposição ───────────────────────────────────────────
// Comunica necessidade + urgência + ação principal. Os controles de
// compra ficam no fluxo focado (/compras/revisar).

function ReposicaoBloco({
  grupos,
  total,
  urgentes,
  estimado,
}: {
  grupos: GrupoReposicao[];
  total: number;
  urgentes: number;
  estimado: number;
}) {
  const peso: Record<SugestaoRow["status"], number> = { ruptura: 0, critico: 1, abaixo: 2 };
  const preview = grupos
    .flatMap((g) => g.itens.filter((it) => it.qtdSugerida > 0))
    .sort((a, b) => peso[a.status] - peso[b.status] || (a.coberturaDias ?? 99) - (b.coberturaDias ?? 99))
    .slice(0, 3);

  if (total === 0) {
    return (
      <section className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-5 py-4 shadow-(--shadow-1)">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ok-soft text-ok">
          <PartyPopper size={18} />
        </span>
        <div>
          <p className="text-sm font-semibold text-ink">Estoque em dia — nada para repor.</p>
          <p className="text-xs text-muted">
            Quando um produto ficar abaixo do mínimo ou o ritmo de venda indicar risco, a sugestão aparece aqui.
          </p>
        </div>
      </section>
    );
  }

  const restantes = total - preview.length;

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-(--shadow-1)">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-faint">Reposição</p>
          <h2 className="mt-1 font-display text-lg font-semibold leading-snug text-ink">
            {total === 1 ? "1 produto precisa de reposição" : `${total} produtos precisam de reposição`}
          </h2>
          {urgentes > 0 && (
            <p className="mt-0.5 text-sm text-danger">
              {urgentes === 1 ? "1 está com risco de venda e precisa de atenção primeiro." : `${urgentes} estão com risco de venda e precisam de atenção primeiro.`}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {estimado > 0 && (
            <p className="text-xs text-muted">
              <span className="font-display text-base font-semibold tabular-nums text-ink">{fmtMoney(estimado)}</span> estimados
            </p>
          )}
          <Link
            href="/compras/revisar"
            className="flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
          >
            Revisar reposição <ArrowRight size={15} />
          </Link>
        </div>
      </div>

      <ul className="divide-y divide-line border-t border-line">
        {preview.map((it) => (
          <li key={it.productId} className="flex items-center gap-3 px-5 py-2.5">
            <StatusDot status={it.status} />
            <Thumb url={it.imagemUrl} nome={it.nome} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{it.nome}</p>
              <p className="text-[11px] text-muted">
                <span className={cn("font-semibold tabular-nums", STATUS_REPO[it.status].text)}>{fmtQtd(it.estoque)}</span> em estoque
                {it.mediaDia > 0 && <> · vende ~{it.mediaDia < 1 ? it.mediaDia.toFixed(1) : Math.round(it.mediaDia)}/dia</>}
              </p>
            </div>
            <span className="shrink-0 text-sm font-medium tabular-nums text-ink">
              Comprar {it.qtdSugerida}
              {it.packagingNome ? <span className="text-xs text-muted"> {it.packagingNome.toLowerCase()}</span> : null}
            </span>
          </li>
        ))}
      </ul>

      {restantes > 0 && (
        <Link
          href="/compras/revisar"
          className="flex items-center justify-between border-t border-line px-5 py-2.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          + {restantes} {restantes === 1 ? "outro produto" : "outros produtos"}
          <ChevronRight size={15} className="text-faint" />
        </Link>
      )}
    </section>
  );
}

// ── Em andamento: cards horizontais compactos ─────────────────

type AndamentoItem =
  | ({ tipo: "pedido"; pedido: PedidoView } & AcaoPedido)
  | { tipo: "transferencia"; transfer: Transfer; peso: number };

type AcaoPedido = { peso: number; cta: string; acao: "receber" | "detalhe"; primaria: boolean };

/** Ordena pela necessidade de ação: receber > rascunho > acompanhar. */
function acaoPedido(p: PedidoView): AcaoPedido {
  switch (p.status) {
    case "RECEBIDO_PARCIAL":
      return { peso: 0, cta: "Continuar recebimento", acao: "receber", primaria: true };
    case "AGUARDANDO":
      return { peso: 1, cta: "Receber pedido", acao: "receber", primaria: true };
    case "RASCUNHO":
      return { peso: 3, cta: "Continuar pedido", acao: "detalhe", primaria: false };
    default: // ENVIADO e (com filtro externo) recebidos/cancelados
      return { peso: 4, cta: "Ver pedido", acao: "detalhe", primaria: false };
  }
}

const prevOrd = (a: AndamentoItem) =>
  a.tipo === "pedido" && a.pedido.previsaoEntrega ? new Date(a.pedido.previsaoEntrega).getTime() : null;

function PedidoCardRow({
  pedido: p,
  cta,
  ctaPrimaria,
  onAbrir,
  onCta,
}: {
  pedido: PedidoView;
  cta: string;
  ctaPrimaria: boolean;
  onAbrir: () => void;
  onCta: () => void;
}) {
  const meta = PEDIDO_STATUS[p.status];
  const unidades = p.items.reduce((a, it) => a + it.qtdPedida, 0);
  const aberto = ["ENVIADO", "AGUARDANDO", "RECEBIDO_PARCIAL"].includes(p.status);
  const prazo = aberto ? estadoEntrega(p.previsaoEntrega) : null;
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onAbrir}
        onKeyDown={(e) => e.key === "Enter" && onAbrir()}
        className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-line bg-surface px-4 py-3 shadow-(--shadow-1) transition-colors hover:border-line-strong hover:bg-surface-2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
      >
        <span
          title={meta?.label ?? p.status}
          className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", meta?.soft ?? "bg-surface-2", meta?.text ?? "text-muted")}
        >
          {meta ? <meta.icon size={16} /> : <Building2 size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{p.supplierNome}</p>
          <p className="truncate text-xs text-muted">
            <span className="font-mono">{p.numero}</span> · {p.totalItems} {p.totalItems === 1 ? "produto" : "produtos"} · {fmtQtd(unidades)} un ·{" "}
            <span className="font-medium tabular-nums text-ink-2">{fmtMoney(p.valorTotal)}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <p className={cn("flex items-center justify-end gap-1.5 text-xs font-semibold", meta?.text ?? "text-muted")}>
              {meta ? <meta.icon size={12} /> : <span className="h-1.5 w-1.5 rounded-full bg-faint" />}
              {meta?.label ?? p.status}
            </p>
            {p.previsaoEntrega && aberto && (
              prazo ? (
                <p className={cn("mt-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-semibold", prazo.cls)}>
                  <prazo.icon size={10} /> {prazo.label}
                </p>
              ) : (
                <p className="text-[11px] text-muted">Previsão: {previsaoLabel(p.previsaoEntrega)}</p>
              )
            )}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCta();
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition-colors",
              ctaPrimaria
                ? "bg-brand text-on-brand hover:bg-brand-strong"
                : "border border-line bg-surface text-ink hover:bg-surface-2",
            )}
          >
            {ctaPrimaria && <PackageCheck size={14} />}
            {p.status === "RASCUNHO" && <Pencil size={14} className="text-muted" />}
            {cta}
          </button>
        </div>
      </div>
    </li>
  );
}

function TransferCardRow({ transfer: t, onReceber }: { transfer: Transfer; onReceber: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-line bg-surface px-4 py-3 shadow-(--shadow-1)">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
        <Truck size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">Transferência de {t.origemNome}</p>
        <p className="truncate text-xs text-muted">
          {t.items.length} {t.items.length === 1 ? "produto" : "produtos"} · em trânsito
          {t.expedidoEm && <> · expedida {relDia(t.expedidoEm)}</>}
        </p>
      </div>
      <button
        type="button"
        onClick={onReceber}
        className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
      >
        <PackageCheck size={14} /> Receber transferência
      </button>
    </li>
  );
}
