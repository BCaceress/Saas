"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Search,
  Download,
  SlidersHorizontal,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Pencil,
  ClipboardList,
  PackageMinus,
  Undo2,
  BottleWine,
  Martini,
  ShoppingCart,
  X,
  Calendar,
  History,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { Sheet } from "@/components/ui/sheet";
import type { MovimentacaoRow } from "../_data";

// ── Config por tipo ────────────────────────────────────────────

type TipoConfig = { label: string; icon: LucideIcon; badge: string; dot: string };

const TIPO: Record<string, TipoConfig> = {
  ENTRADA: { label: "Entrada", icon: ArrowDownLeft, badge: "bg-ok-soft text-ok", dot: "bg-ok" },
  ABERTURA: { label: "Abertura", icon: BottleWine, badge: "bg-surface-2 text-muted", dot: "bg-muted" },
  SAIDA: { label: "Saída", icon: ArrowUpRight, badge: "bg-danger-soft text-danger", dot: "bg-danger" },
  TRANSFERENCIA: { label: "Transferência", icon: ArrowLeftRight, badge: "bg-brand-soft text-brand", dot: "bg-brand" },
  PRODUCAO: { label: "Produção", icon: Martini, badge: "bg-violet-soft text-violet", dot: "bg-violet" },
  AJUSTE: { label: "Ajuste", icon: Pencil, badge: "bg-info-soft text-info", dot: "bg-info" },
  PERDA: { label: "Perda", icon: PackageMinus, badge: "bg-danger-soft text-danger", dot: "bg-danger" },
  DEVOLUCAO_CLIENTE: { label: "Devolução", icon: Undo2, badge: "bg-ok-soft text-ok", dot: "bg-ok" },
  DEVOLUCAO_FORNECEDOR: { label: "Devolução", icon: Undo2, badge: "bg-danger-soft text-danger", dot: "bg-danger" },
};

const tipoOf = (t: string): TipoConfig =>
  TIPO[t] ?? { label: t, icon: Pencil, badge: "bg-surface-2 text-muted", dot: "bg-muted" };

// Saída originada de venda ganha badge próprio — "Saída" fica só para a manual.
const VENDA_CFG: TipoConfig = { label: "Venda", icon: ShoppingCart, badge: "bg-accent-soft text-accent", dot: "bg-accent" };

const tipoDe = (r: MovimentacaoRow): TipoConfig =>
  r.tipo === "SAIDA" && r.origem.startsWith("Venda") ? VENDA_CFG : tipoOf(r.tipo);

// ── Filtros (espelham os ids resolvidos no servidor em _data.ts) ──

const CHIPS: { id: string; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "entradas", label: "Entradas" },
  { id: "vendas", label: "Vendas" },
  { id: "saidas", label: "Saídas" },
  { id: "transferencias", label: "Transferências" },
  { id: "producao", label: "Produção" },
  { id: "ajustes", label: "Ajustes" },
];

const PERIODOS: { id: string; label: string }[] = [
  { id: "tudo", label: "Todo período" },
  { id: "0", label: "Hoje" },
  { id: "7", label: "Últimos 7 dias" },
  { id: "30", label: "Últimos 30 dias" },
  { id: "90", label: "Últimos 90 dias" },
];

const ORIGENS: { id: string; label: string }[] = [
  { id: "compra", label: "Entrada por compra" },
  { id: "entrada_manual", label: "Entrada manual" },
  { id: "venda_pdv", label: "Venda no PDV" },
  { id: "venda_totem", label: "Venda no autoatendimento" },
  { id: "venda_app", label: "Venda pelo app" },
  { id: "saida_manual", label: "Saída manual" },
  { id: "abertura", label: "Abertura de garrafa" },
  { id: "transferencia", label: "Transferência" },
  { id: "producao", label: "Produção" },
  { id: "ajuste_manual", label: "Ajuste manual" },
  { id: "ajuste_inventario", label: "Ajuste por inventário" },
  { id: "estorno_venda", label: "Estorno de venda" },
  { id: "perda", label: "Perda / quebra" },
  { id: "devolucao_cliente", label: "Devolução de cliente" },
  { id: "devolucao_fornecedor", label: "Devolução ao fornecedor" },
];

const POR_PAGINA = [25, 50, 100, 250];

// ── Formatação ─────────────────────────────────────────────────

const numFmt = (v: number) =>
  v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function movimentoStr(v: number) {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${numFmt(Math.abs(v))}`;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dateParts(d: Date): { label: string; time: string } {
  const now = new Date();
  const ontem = new Date(now);
  ontem.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (sameDay(d, now)) return { label: "Hoje", time };
  if (sameDay(d, ontem)) return { label: "Ontem", time };
  return {
    label: d
      .toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })
      .replace(".", ""),
    time,
  };
}

const fmtDateTime = (d: Date) =>
  d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

// ── Componente principal ───────────────────────────────────────

export type MovFiltros = {
  q: string;
  tipo: string;
  periodo: string;
  origem: string;
  resp: string;
};

export function MovimentacoesView({
  rows,
  total,
  pagina,
  porPagina,
  responsaveis,
  filtros,
}: {
  rows: MovimentacaoRow[];
  total: number;
  pagina: number;
  porPagina: number;
  responsaveis: { id: string; nome: string }[];
  filtros: MovFiltros;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const [busca, setBusca] = useState(filtros.q);
  const [avancado, setAvancado] = useState(!!filtros.origem || !!filtros.resp);
  const [selected, setSelected] = useState<MovimentacaoRow | null>(null);

  // Filtros vivem na URL: recarregar/compartilhar/voltar preserva o extrato.
  function setParams(patch: Record<string, string>, opts: { resetPagina?: boolean } = { resetPagina: true }) {
    const params = new URLSearchParams({
      q: filtros.q,
      tipo: filtros.tipo,
      periodo: filtros.periodo,
      origem: filtros.origem,
      resp: filtros.resp,
      pp: String(porPagina),
      pagina: String(pagina),
    });
    for (const [k, v] of Object.entries(patch)) params.set(k, v);
    if (opts.resetPagina !== false) params.set("pagina", "1");
    // Defaults ficam fora da URL para ela permanecer limpa.
    if (params.get("q") === "") params.delete("q");
    if (params.get("tipo") === "todos") params.delete("tipo");
    if (params.get("periodo") === "7") params.delete("periodo");
    if (params.get("origem") === "") params.delete("origem");
    if (params.get("resp") === "") params.delete("resp");
    if (params.get("pp") === "100") params.delete("pp");
    if (params.get("pagina") === "1") params.delete("pagina");
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  // Busca com debounce — digitação não dispara uma navegação por tecla.
  const buscaRef = useRef(filtros.q);
  useEffect(() => {
    if (busca === buscaRef.current) return;
    const t = setTimeout(() => {
      buscaRef.current = busca;
      setParams({ q: busca });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);

  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const inicio = (pagina - 1) * porPagina;

  function exportar() {
    const head = ["Tipo", "Produto", "SKU", "Origem", "Documento", "Movimento", "Saldo", "Custo un.", "Valor total", "Responsável", "Data"];
    const lines = rows.map((r) =>
      [
        tipoDe(r).label,
        r.productNome,
        r.productSku,
        r.origem,
        r.documento ?? "",
        movimentoStr(r.deltaFechado),
        r.saldoDepois != null ? numFmt(r.saldoDepois) : "",
        r.custoUnitario != null ? String(r.custoUnitario).replace(".", ",") : "",
        r.valorTotal != null ? String(r.valorTotal.toFixed(2)).replace(".", ",") : "",
        r.responsavel ?? "",
        fmtDateTime(new Date(r.createdAt)),
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(";"),
    );
    const csv = "﻿" + [head.join(";"), ...lines].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `movimentacoes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const temFiltro =
    filtros.tipo !== "todos" || filtros.periodo !== "tudo" || !!filtros.q || !!filtros.origem || !!filtros.resp;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Movimentações"
        icon={History}
        description="Histórico auditável de tudo que entrou, saiu ou foi ajustado no estoque."
        backHref="/estoque"
        innerClassName="max-w-none"
        className="pb-3"
      />

      {/* ── Barra de controles ── */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Pesquisa */}
          <div className="relative min-w-56 flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar produto, SKU, observação…"
              className="h-9 w-full rounded-full border border-line bg-surface pl-9 pr-8 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-(--ring)"
            />
            {busca && (
              <button
                onClick={() => setBusca("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer text-faint hover:text-ink"
                aria-label="Limpar busca"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Período */}
          <div className="relative">
            <Calendar size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <select
              value={filtros.periodo}
              onChange={(e) => setParams({ periodo: e.target.value })}
              className="h-9 cursor-pointer appearance-none rounded-full border border-line bg-surface pl-8 pr-8 text-sm font-medium text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-(--ring)"
            >
              {PERIODOS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* Filtros avançados */}
          <button
            onClick={() => setAvancado((v) => !v)}
            className={cn(
              "flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
              avancado || filtros.origem || filtros.resp
                ? "border-brand bg-brand-soft text-brand"
                : "border-line bg-surface text-ink hover:bg-surface-2",
            )}
          >
            <SlidersHorizontal size={14} />
            Filtros
          </button>

          {/* Exportar (página atual) */}
          <button
            onClick={exportar}
            className="flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            <Download size={14} />
            Exportar
          </button>
        </div>

        {/* Chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {CHIPS.map((c) => (
            <button
              key={c.id}
              onClick={() => setParams({ tipo: c.id })}
              className={cn(
                "h-7 cursor-pointer rounded-full px-3 text-xs font-semibold transition-colors",
                filtros.tipo === c.id
                  ? "bg-ink text-surface"
                  : "border border-line bg-surface text-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Painel de filtros avançados */}
        {avancado && (
          <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-lg)] border border-line bg-surface-2 p-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              Origem
              <select
                value={filtros.origem}
                onChange={(e) => setParams({ origem: e.target.value })}
                className="h-8 cursor-pointer rounded-lg border border-line bg-surface px-2 text-sm text-ink focus:border-brand focus:outline-none"
              >
                <option value="">Todas</option>
                {ORIGENS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              Responsável
              <select
                value={filtros.resp}
                onChange={(e) => setParams({ resp: e.target.value })}
                className="h-8 cursor-pointer rounded-lg border border-line bg-surface px-2 text-sm text-ink focus:border-brand focus:outline-none"
              >
                <option value="">Todos</option>
                {responsaveis.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nome}
                  </option>
                ))}
                <option value="__sistema">Sistema</option>
              </select>
            </label>
            {(filtros.origem || filtros.resp) && (
              <button
                onClick={() => setParams({ origem: "", resp: "" })}
                className="h-8 cursor-pointer rounded-lg px-2 text-xs font-medium text-muted hover:text-ink"
              >
                Limpar
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Tabela ── */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[var(--radius-xl)] border border-line bg-surface py-16 text-center">
          <ClipboardList size={32} className="text-faint" />
          <p className="text-sm font-medium text-muted">
            {temFiltro ? "Nenhuma movimentação com esses filtros." : "Nenhuma movimentação registrada ainda."}
          </p>
          {temFiltro && (
            <button
              onClick={() => {
                setBusca("");
                buscaRef.current = "";
                setParams({ q: "", tipo: "todos", periodo: "tudo", origem: "", resp: "" });
              }}
              className="cursor-pointer text-xs font-semibold text-brand hover:underline"
            >
              Limpar filtros
            </button>
          )}
        </div>
      ) : (
        <div
          className={cn(
            "overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-surface transition-opacity",
            pending && "pointer-events-none opacity-60",
          )}
        >
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-faint">
                <th className="px-4 py-2.5 font-semibold">Tipo</th>
                <th className="px-4 py-2.5 font-semibold">Produto</th>
                <th className="hidden px-4 py-2.5 font-semibold md:table-cell">Origem</th>
                <th className="px-4 py-2.5 text-right font-semibold">Movimento</th>
                <th className="px-4 py-2.5 text-right font-semibold">Saldo</th>
                <th className="hidden px-4 py-2.5 font-semibold lg:table-cell">Responsável</th>
                <th className="px-4 py-2.5 text-right font-semibold">Data</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const cfg = tipoDe(r);
                const Icon = cfg.icon;
                const d = dateParts(new Date(r.createdAt));
                const dAnterior = i > 0 ? dateParts(new Date(rows[i - 1].createdAt)) : null;
                const novoDia = !dAnterior || dAnterior.label !== d.label;
                return (
                  <FragmentRow
                    key={r.id}
                    separador={novoDia ? d.label : null}
                    row={r}
                    cfg={cfg}
                    Icon={Icon}
                    time={d.time}
                    onClick={() => setSelected(r)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Paginação ── */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2 text-xs text-faint">
            <span>
              {inicio + 1}–{Math.min(inicio + rows.length, total)} de {total}
            </span>
            <span className="text-line">·</span>
            <label className="flex items-center gap-1.5">
              Exibir
              <select
                value={porPagina}
                onChange={(e) => setParams({ pp: e.target.value })}
                className="h-7 cursor-pointer appearance-none rounded-lg border border-line bg-surface px-2 text-xs font-medium text-ink focus:border-brand focus:outline-none"
              >
                {POR_PAGINA.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              por página
            </label>
          </div>

          {totalPaginas > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setParams({ pagina: String(pagina - 1) }, { resetPagina: false })}
                disabled={pagina <= 1 || pending}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-ink transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40"
                aria-label="Página anterior"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="min-w-20 text-center text-xs font-medium text-muted">
                Página {pagina} de {totalPaginas}
              </span>
              <button
                onClick={() => setParams({ pagina: String(pagina + 1) }, { resetPagina: false })}
                disabled={pagina >= totalPaginas || pending}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-ink transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40"
                aria-label="Próxima página"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Side panel ── */}
      <DetalhePanel row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

// ── Linha (com separador de dia opcional) ──────────────────────

function FragmentRow({
  separador,
  row: r,
  cfg,
  Icon,
  time,
  onClick,
}: {
  separador: string | null;
  row: MovimentacaoRow;
  cfg: TipoConfig;
  Icon: LucideIcon;
  time: string;
  onClick: () => void;
}) {
  return (
    <>
      {separador && (
        <tr aria-hidden className="border-b border-line/60 bg-surface-2/60">
          <td colSpan={7} className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
            {separador}
          </td>
        </tr>
      )}
      <tr
        onClick={onClick}
        className="group h-[54px] cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2"
      >
        {/* Tipo */}
        <td className="px-4">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full py-1 pl-1.5 pr-2.5 text-[11px] font-semibold", cfg.badge)}>
            <Icon size={16} className="shrink-0" />
            {cfg.label}
          </span>
        </td>

        {/* Produto */}
        <td className="px-4">
          <p className="max-w-90 truncate font-medium leading-tight text-ink">{r.productNome}</p>
          {r.productSku && (
            <p className="font-mono text-[11px] leading-tight text-faint">SKU {r.productSku}</p>
          )}
        </td>

        {/* Origem + documento */}
        <td className="hidden px-4 md:table-cell">
          <span className="block max-w-72 truncate text-xs text-muted" title={r.origem}>
            {r.origem}
          </span>
          {r.documento && (
            <span className="block max-w-72 truncate font-mono text-[11px] leading-tight text-faint">
              {r.documento}
            </span>
          )}
        </td>

        {/* Movimento */}
        <td
          className={cn(
            "px-4 text-right font-mono text-sm font-semibold tabular-nums",
            r.deltaFechado > 0 ? "text-ok" : r.deltaFechado < 0 ? "text-danger" : "text-muted",
          )}
        >
          {movimentoStr(r.deltaFechado)}
        </td>

        {/* Saldo */}
        <td className="px-4 text-right font-mono text-sm tabular-nums text-ink">
          {r.saldoDepois != null ? (
            <>
              {numFmt(r.saldoDepois)}
              <span className="ml-1 text-[11px] text-faint">un</span>
            </>
          ) : (
            <span className="text-faint">—</span>
          )}
        </td>

        {/* Responsável */}
        <td className="hidden px-4 lg:table-cell">
          <span className="text-xs text-muted">{r.responsavel ?? "Sistema"}</span>
        </td>

        {/* Data */}
        <td className="whitespace-nowrap px-4 text-right">
          <span className="font-mono text-xs text-muted">{time}</span>
        </td>
      </tr>
    </>
  );
}

// ── Painel de detalhes ─────────────────────────────────────────

// Destino navegável do registro vinculado, quando existe tela para ele.
function linkVinculo(row: MovimentacaoRow): { href: string; label: string } | null {
  if (row.origem === "Entrada por pedido de compra" && row.documento) {
    return { href: `/compras?q=${encodeURIComponent(row.documento)}`, label: "Ver pedido de compra" };
  }
  if (row.tipo === "TRANSFERENCIA") {
    return { href: "/estoque/transferencias", label: "Ver transferências" };
  }
  if (row.origem === "Ajuste por inventário") {
    return { href: "/estoque/inventario", label: "Ver inventários" };
  }
  return null;
}

function DetalhePanel({ row, onClose }: { row: MovimentacaoRow | null; onClose: () => void }) {
  const cfg = row ? tipoDe(row) : null;
  const Icon = cfg?.icon;
  const saldoAntes = row && row.saldoDepois != null ? row.saldoDepois - row.deltaFechado : null;
  const vinculo = row ? linkVinculo(row) : null;

  return (
    <Sheet open={!!row} onClose={onClose} title="Movimentação" description={row ? cfg?.label : undefined} width="md">
      {row && cfg && Icon && (
        <div className="flex flex-col gap-5">
          {/* Cabeçalho */}
          <div className="flex items-start gap-3">
            <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", cfg.badge)}>
              <Icon size={20} />
            </span>
            <div className="min-w-0">
              <p className="font-medium leading-tight text-ink">{row.productNome}</p>
              {row.productSku && <p className="font-mono text-xs text-faint">SKU {row.productSku}</p>}
            </div>
            <span
              className={cn(
                "ml-auto shrink-0 font-mono text-lg font-bold tabular-nums",
                row.deltaFechado > 0 ? "text-ok" : row.deltaFechado < 0 ? "text-danger" : "text-muted",
              )}
            >
              {movimentoStr(row.deltaFechado)}
            </span>
          </div>

          {/* Saldo antes → depois */}
          {row.saldoDepois != null && (
            <div className="flex items-center justify-between rounded-[var(--radius-lg)] border border-line bg-surface-2 px-4 py-3">
              <div className="text-center">
                <p className="text-[11px] uppercase tracking-wide text-faint">Saldo antes</p>
                <p className="font-mono text-base tabular-nums text-muted">{saldoAntes != null ? numFmt(saldoAntes) : "—"}</p>
              </div>
              <ArrowLeftRight size={16} className="text-faint" />
              <div className="text-center">
                <p className="text-[11px] uppercase tracking-wide text-faint">Saldo depois</p>
                <p className="font-mono text-base font-semibold tabular-nums text-ink">{numFmt(row.saldoDepois)}</p>
              </div>
            </div>
          )}

          {/* Detalhes */}
          <dl className="flex flex-col divide-y divide-line rounded-[var(--radius-lg)] border border-line">
            <Detail label="Origem" value={row.origem} />
            {row.documento && <Detail label="Documento" value={row.documento} mono />}
            {row.fornecedor && <Detail label="Fornecedor" value={row.fornecedor} />}
            {row.local && <Detail label="Local" value={row.local} />}
            {row.productEan && <Detail label="Código de barras" value={row.productEan} mono />}
            <Detail label="Qtd. movimentada (fechado)" value={movimentoStr(row.deltaFechado)} mono />
            {row.deltaAberto !== 0 && <Detail label="Qtd. movimentada (aberto)" value={movimentoStr(row.deltaAberto)} mono />}
            {row.custoUnitario != null && <Detail label="Custo unitário" value={brl(row.custoUnitario)} mono />}
            {row.valorTotal != null && <Detail label="Valor total" value={brl(row.valorTotal)} mono />}
            <Detail label="Responsável" value={row.responsavel ?? "Sistema"} />
            <Detail label="Data e hora" value={fmtDateTime(new Date(row.createdAt))} mono />
          </dl>

          {/* Observações */}
          {row.observacao && (
            <div className="flex flex-col gap-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Observações</p>
              <p className="rounded-[var(--radius-lg)] border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink">{row.observacao}</p>
            </div>
          )}

          {/* Registro vinculado */}
          {vinculo && (
            <Link
              href={vinculo.href}
              className="flex items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
            >
              <ExternalLink size={14} className="text-muted" />
              {vinculo.label}
            </Link>
          )}
        </div>
      )}
    </Sheet>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn("text-right text-sm text-ink", mono && "font-mono tabular-nums")}>{value}</dd>
    </div>
  );
}
