"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  PackageCheck,
  Pencil,
  Truck,
  TriangleAlert,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import type { GrupoReposicao } from "./_data";
import { PedidoDrawer, PedidoFormSheet, type FormOptions, type PedidoView } from "./_pedidos";
import { PedidoReceber, TransferReceber, type Transfer } from "./_recebimentos";
import { estadoEntrega, fmtMoney, fmtQtd, previsaoLabel, relDia, urgenciaEntrega, PEDIDO_STATUS } from "./_ui";

// ── Inbox operacional de Compras ──────────────────────────────
// Sem abas: a tela responde "o que precisa da minha atenção agora?"
// em dois blocos verticais — Reposição (a decisão) e Em andamento
// (processos vivos).

const ATIVOS = ["RASCUNHO", "ENVIADO", "AGUARDANDO", "RECEBIDO_PARCIAL"];

export function ComprasInbox({
  grupos,
  pedidos,
  transferencias,
  formOptions,
  empresa,
  initialQuery,
}: {
  grupos: GrupoReposicao[];
  pedidos: PedidoView[];
  transferencias: Transfer[];
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
    let noRadar = 0;
    let estimado = 0;
    for (const g of grupos) {
      for (const it of g.itens) {
        if (it.qtdSugerida <= 0) continue;
        if (it.status === "monitorar") noRadar += 1;
        else if (it.status === "abaixo") repor += 1;
        else urgentes += 1;
        estimado += it.qtdSugerida * (it.custoUnitCompra ?? 0);
      }
    }
    return { urgentes, repor, noRadar, estimado };
  }, [grupos]);

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

  const totalReposicao = stats.urgentes + stats.repor + stats.noRadar;

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
      {!filtro && (
        <ReposicaoBloco
          total={totalReposicao}
          urgentes={stats.urgentes}
          noRadar={stats.noRadar}
          estimado={stats.estimado}
        />
      )}

      {/* ── Em andamento ── */}
      <section className="flex flex-col gap-2.5">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-faint">
          {filtro ? "Pedidos encontrados" : "Em andamento"}
          {!filtro && andamento.length > 0 && (
            <span className="rounded-full bg-surface-2 px-1.5 py-px text-[11px] font-semibold tabular-nums text-muted">{andamento.length}</span>
          )}
        </h2>
        {andamento.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
            {filtro ? "Nenhum pedido com esse termo." : "Nenhum pedido em andamento."}
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
// Comunica só a necessidade + urgência + ação principal — os produtos
// ficam no fluxo focado (/compras/revisar), não aqui.

function ReposicaoBloco({
  total,
  urgentes,
  noRadar,
  estimado,
}: {
  total: number;
  urgentes: number;
  noRadar: number;
  estimado: number;
}) {
  if (total === 0) {
    return (
      <section className="flex items-center gap-3 rounded-2xl border border-ok/15 bg-ok-soft/40 px-5 py-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ok-soft text-lg" aria-hidden>
          🎉
        </span>
        <div>
          <p className="text-sm font-semibold text-ink">Estoque em dia</p>
          <p className="text-xs text-muted">Nenhum produto precisa de reposição no momento.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-warn/20 bg-warn-soft/30 px-5 py-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-warn-soft text-warn">
        <TriangleAlert size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-base font-semibold leading-snug text-ink">
          {total === 1 ? "1 produto precisa de reposição" : `${total} produtos precisam de reposição`}
        </h2>
        <p className="mt-0.5 text-xs text-muted">
          {urgentes > 0 && (
            <span className="font-medium text-danger">
              {urgentes === 1 ? "1 com risco de ruptura" : `${urgentes} com risco de ruptura`}
            </span>
          )}
          {urgentes > 0 && noRadar > 0 && " · "}
          {noRadar > 0 && (
            <span className="font-medium text-brand">
              {noRadar === 1 ? "1 abaixo do ideal" : `${noRadar} abaixo do ideal`}
            </span>
          )}
          {(urgentes > 0 || noRadar > 0) && estimado > 0 && " · "}
          {estimado > 0 && <span className="font-medium tabular-nums text-ink">{fmtMoney(estimado)}</span>}
          {estimado > 0 && " estimados"}
        </p>
      </div>
      <Link
        href="/compras/revisar"
        className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
      >
        Revisar reposição <ArrowRight size={15} />
      </Link>
    </section>
  );
}

// ── Em andamento: cards horizontais compactos ─────────────────

type AndamentoItem =
  | ({ tipo: "pedido"; pedido: PedidoView } & AcaoPedido)
  | { tipo: "transferencia"; transfer: Transfer; peso: number };

type AcaoPedido = { peso: number; cta: string; acao: "receber" | "detalhe"; primaria: boolean };

/**
 * Ordena pela necessidade de ação, não pelo status: atrasados e previstos
 * para hoje sempre no topo, mesmo que o status "oficial" seja outro.
 */
function acaoPedido(p: PedidoView): AcaoPedido {
  const aberto = ["ENVIADO", "AGUARDANDO", "RECEBIDO_PARCIAL"].includes(p.status);
  const urgencia = aberto ? urgenciaEntrega(p.previsaoEntrega) : null;

  switch (p.status) {
    case "RECEBIDO_PARCIAL":
      return { peso: urgencia === 0 ? 0 : urgencia === 1 ? 1 : 2, cta: "Continuar recebimento", acao: "receber", primaria: true };
    case "AGUARDANDO":
      return { peso: urgencia === 0 ? 0 : urgencia === 1 ? 1 : 3, cta: "Receber pedido", acao: "receber", primaria: true };
    case "ENVIADO":
      return { peso: urgencia === 0 ? 0 : urgencia === 1 ? 1 : 4, cta: "Ver pedido", acao: "detalhe", primaria: false };
    case "RASCUNHO":
      return { peso: 5, cta: "Continuar pedido", acao: "detalhe", primaria: false };
    default: // recebidos/cancelados (só aparecem com filtro externo)
      return { peso: 6, cta: "Ver pedido", acao: "detalhe", primaria: false };
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
