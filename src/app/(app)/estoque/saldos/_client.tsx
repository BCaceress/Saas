"use client";

import { useMemo, useState, useEffect, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  AlertOctagon,
  Barcode,
  Search,
  Boxes,
  Download,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  ChevronRight,
  History,
  ArrowLeftRight,
  Zap,
  SlidersHorizontal,
  Loader2,
  PackageX,
  PackageOpen,
  PackageCheck,
  Pencil,
  Wallet,
  Warehouse,
  ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import { StockGauge } from "@/components/stock-gauge";
import { NovaEntradaForm, type Item } from "../entradas/nova/_client";
import type { SaldoRow } from "../_data";
import { fetchHistoricoProductAction, registrarAjusteAction } from "../actions";

const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const fmtMoney = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtMoneyShort = (v: number) =>
  v >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k` : fmtMoney(v);
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const TIPO_LABEL: Record<string, string> = {
  SIMPLES: "Simples",
  INSUMO: "Insumo",
  COMBO: "Combo",
  PERSONALIZADO: "Personalizado",
};

const TIPO_MOV: Record<string, { label: string; cor: string }> = {
  ENTRADA:       { label: "Entrada",       cor: "text-ok"       },
  SAIDA:         { label: "Saída",         cor: "text-danger"   },
  AJUSTE:        { label: "Ajuste",        cor: "text-muted"    },
  TRANSFERENCIA: { label: "Transferência", cor: "text-brand"    },
  ABERTURA:      { label: "Abertura",      cor: "text-brand"    },
  PRODUCAO:      { label: "Produção",      cor: "text-blue-500" },
  PERDA:         { label: "Perda",         cor: "text-warn"     },
  DEVOLUCAO_CLIENTE:    { label: "Devolução cliente",    cor: "text-ok"     },
  DEVOLUCAO_FORNECEDOR: { label: "Devolução fornecedor", cor: "text-danger" },
};

const SALE_ORIGEM_LABEL: Record<string, string> = {
  PDV:   "Venda no caixa",
  TOTEM: "Venda no totem",
  APP:   "Venda online",
};

function getMovLabel(m: HistoricoItem): string {
  if (m.tipo === "SAIDA" && m.saleOrigem) return SALE_ORIGEM_LABEL[m.saleOrigem] ?? "Saída";
  if (m.tipo === "ENTRADA") {
    if (m.purchaseTipo === "FORNECEDOR") return "Entrada — Fornecedor";
    if (m.purchaseTipo === "MANUAL")     return "Entrada — Manual";
  }
  return TIPO_MOV[m.tipo]?.label ?? m.tipo;
}

function getMovSub(m: HistoricoItem): string | null {
  if (m.tipo === "ENTRADA" && m.purchaseTipo === "FORNECEDOR" && m.purchaseSupplier) {
    return m.purchaseSupplier;
  }
  if (m.tipo === "PRODUCAO" && m.producaoDrinkNome) {
    return `Drink: ${m.producaoDrinkNome}`;
  }
  return null;
}

type Filtro = "todos" | "com" | "sem" | "baixo" | "critico" | "revisar";
type SortKey = "nome" | "fechado" | "min" | "custo" | "valor";
type SortDir = "asc" | "desc";
type FormOptions = Pick<ComponentProps<typeof NovaEntradaForm>, "products" | "suppliers" | "sites">;
type HistoricoItem = Awaited<ReturnType<typeof fetchHistoricoProductAction>>[number];

const semEstoque = (s: SaldoRow) => s.estoqueFechado === 0 && s.estoqueAberto === 0;
const isCritico = (s: SaldoRow) =>
  semEstoque(s) || (s.estoqueMinimo > 0 && s.estoqueFechado <= s.estoqueMinimo / 2);
const valorEstoque = (s: SaldoRow) => s.estoqueFechado * (s.custoMedio ?? 0);

/** Lacunas de cadastro que atrapalham operação (custo, fornecedor, localização). */
function dataGaps(s: SaldoRow): ("custo" | "fornecedor" | "local")[] {
  const g: ("custo" | "fornecedor" | "local")[] = [];
  if (s.custoMedio == null) g.push("custo");
  if (!s.temFornecedor) g.push("fornecedor");
  if (!s.locationNome) g.push("local");
  return g;
}

function getPriority(s: SaldoRow): number {
  if (semEstoque(s)) return 0;
  if (s.estoqueMinimo > 0 && s.estoqueFechado <= s.estoqueMinimo / 2) return 1;
  if (s.abaixoMinimo) return 2;
  return 3;
}

/* CSV: separador ";" e decimal com vírgula (Excel pt-BR). */
function toCsv(rows: SaldoRow[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3, useGrouping: false });
  const head = ["Produto", "Tipo", "SKU", "Codigo de barras", "Fechado", "Aberto", "Minimo", "Ideal", "Custo medio", "Valor em estoque", "Local"];
  const body = rows.map((s) => [
    esc(s.nome),
    esc(TIPO_LABEL[s.tipo] ?? s.tipo),
    esc(s.sku),
    esc(s.ean ?? ""),
    num(s.estoqueFechado),
    num(s.estoqueAberto),
    num(s.estoqueMinimo),
    num(s.estoqueIdeal),
    num(s.custoMedio ?? 0),
    num(valorEstoque(s)),
    esc(s.locationNome ?? ""),
  ].join(";"));
  return [head.join(";"), ...body].join("\r\n");
}

function baixarCsv(rows: SaldoRow[]) {
  const csv = "﻿" + toCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `saldos-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Componente principal ──────────────────────────────────────

export function SaldosView({
  saldos,
  formOptions,
  siteId,
}: {
  saldos: SaldoRow[];
  formOptions: FormOptions;
  siteId: string | null;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);
  const [reporItems, setReporItems] = useState<Item[] | null>(null);
  const [detalhe, setDetalhe] = useState<SaldoRow | null>(null);

  const kpis = useMemo(() => {
    let valor = 0, sem = 0, repor = 0, critico = 0, revisar = 0;
    for (const s of saldos) {
      valor += valorEstoque(s);
      if (semEstoque(s)) sem++;
      if (s.abaixoMinimo) repor++;
      if (isCritico(s)) critico++;
      if (dataGaps(s).length > 0) revisar++;
    }
    return { valor, sem, repor, critico, revisar, total: saldos.length };
  }, [saldos]);

  const counts = useMemo(() => {
    let com = 0;
    for (const s of saldos) if (!semEstoque(s)) com++;
    return { todos: saldos.length, com, sem: kpis.sem, baixo: kpis.repor, critico: kpis.critico, revisar: kpis.revisar };
  }, [saldos, kpis]);

  const filtrados = useMemo(() => {
    const termo = q.trim().toLowerCase();
    const out = saldos.filter((s) => {
      switch (filtro) {
        case "com":     if (semEstoque(s)) return false; break;
        case "sem":     if (!semEstoque(s)) return false; break;
        case "baixo":   if (!s.abaixoMinimo) return false; break;
        case "critico": if (!isCritico(s)) return false; break;
        case "revisar": if (dataGaps(s).length === 0) return false; break;
      }
      if (termo) {
        const alvo = `${s.nome} ${s.sku} ${s.ean ?? ""}`.toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      return true;
    });

    out.sort((a, b) => {
      const pa = getPriority(a), pb = getPriority(b);
      if (pa !== pb) return pa - pb;
      if (sort) {
        const f = (s: SaldoRow) =>
          sort.key === "nome"      ? s.nome.toLowerCase()
          : sort.key === "fechado" ? s.estoqueFechado
          : sort.key === "min"     ? s.estoqueMinimo
          : sort.key === "custo"   ? (s.custoMedio ?? 0)
          : valorEstoque(s);
        const va = f(a), vb = f(b);
        const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
        return sort.dir === "asc" ? cmp : -cmp;
      }
      return a.nome.localeCompare(b.nome);
    });

    return out;
  }, [saldos, q, filtro, sort]);

  const totalValorFiltrado = useMemo(
    () => filtrados.reduce((acc, s) => acc + valorEstoque(s), 0),
    [filtrados],
  );

  function toggleSort(key: SortKey) {
    setSort((cur) =>
      cur?.key === key
        ? cur.dir === "asc" ? { key, dir: "desc" } : null
        : { key, dir: "asc" },
    );
  }

  function abrirReposicao(scope: SaldoRow[]) {
    const productIds = new Set(formOptions.products.map((p) => p.id));
    const items: Item[] = scope
      .filter((s) => s.abaixoMinimo && productIds.has(s.productId))
      .map((s) => {
        const deficit = s.estoqueIdeal - s.estoqueFechado;
        const prod = formOptions.products.find((p) => p.id === s.productId);
        const padrao = prod?.packagings.find((pk) => pk.isCompraDefault);
        return {
          productId: s.productId,
          quantidade: deficit > 0 ? deficit : 1,
          custoTotal: 0,
          custoDisplay: "",
          packagingId: padrao?.id ?? null,
        };
      });
    setReporItems(items.length > 0 ? items : [
      { productId: "", quantidade: 1, custoTotal: 0, custoDisplay: "", packagingId: null },
    ]);
  }

  const pills: { key: Filtro; label: string; count: number; tone: "neutral" | "danger" | "warn" }[] = [
    { key: "todos",   label: "Todos",          count: counts.todos,   tone: "neutral" },
    { key: "com",     label: "Com estoque",    count: counts.com,     tone: "neutral" },
    { key: "sem",     label: "Sem estoque",    count: counts.sem,     tone: "danger" },
    { key: "critico", label: "Críticos",       count: counts.critico, tone: "danger" },
    { key: "baixo",   label: "Abaixo do mín.", count: counts.baixo,   tone: "warn" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* ── Faixa de saúde (KPIs) ── */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi
          icon={Wallet}
          label="Valor em estoque"
          value={fmtMoneyShort(kpis.valor)}
          hint={`${kpis.total} ${kpis.total === 1 ? "item" : "itens"}`}
        />
        <Kpi
          icon={PackageX}
          label="Sem estoque"
          value={String(kpis.sem)}
          tone="danger"
          active={filtro === "sem"}
          onClick={() => setFiltro(filtro === "sem" ? "todos" : "sem")}
          hint={kpis.sem > 0 ? "perdendo venda" : "tudo abastecido"}
        />
        <Kpi
          icon={AlertOctagon}
          label="Críticos"
          value={String(kpis.critico)}
          tone="danger"
          active={filtro === "critico"}
          onClick={() => setFiltro(filtro === "critico" ? "todos" : "critico")}
          hint="zerados + metade do mín."
        />
        <Kpi
          icon={RefreshCw}
          label="A repor"
          value={String(kpis.repor)}
          tone="warn"
          active={filtro === "baixo"}
          onClick={() => setFiltro(filtro === "baixo" ? "todos" : "baixo")}
          action={
            kpis.repor > 0
              ? { label: "Repor", onClick: () => abrirReposicao(saldos) }
              : undefined
          }
        />
      </div>

      {/* ── Toolbar: filtros + busca + ações ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {pills.map((p) => (
            <FilterPill
              key={p.key}
              label={p.label}
              count={p.count}
              tone={p.tone}
              active={filtro === p.key}
              onClick={() => setFiltro(p.key)}
            />
          ))}
          {counts.revisar > 0 && (
            <>
              <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
              <FilterPill
                label="Revisar cadastro"
                count={counts.revisar}
                tone="warn"
                icon={ClipboardList}
                active={filtro === "revisar"}
                onClick={() => setFiltro(filtro === "revisar" ? "todos" : "revisar")}
              />
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-60 sm:flex-none">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar nome, SKU ou código"
              className="w-full rounded-full border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
            />
          </div>
          <button
            type="button"
            onClick={() => baixarCsv(filtrados)}
            disabled={filtrados.length === 0}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
            title="Exportar CSV"
          >
            <Download size={15} />
            <span className="hidden sm:inline">Exportar</span>
          </button>
        </div>
      </div>

      {filtrados.length === 0 ? (
        <EmptyState filtro={filtro} busca={q} />
      ) : (
        <>
          {/* ── Tabela (desktop) ── */}
          <div className="hidden overflow-hidden rounded-xl border border-line bg-surface md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-xs font-semibold uppercase tracking-wide text-faint">
                  <Th label="Produto" sortKey="nome" sort={sort} onSort={toggleSort} />
                  <Th label="Medidor de saldo" sortKey="fechado" sort={sort} onSort={toggleSort} />
                  <Th label="Mín / Ideal" sortKey="min" sort={sort} onSort={toggleSort} align="right" />
                  <Th label="Custo médio" sortKey="custo" sort={sort} onSort={toggleSort} align="right" />
                  <Th label="Valor" sortKey="valor" sort={sort} onSort={toggleSort} align="right" />
                  <th className="w-8 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtrados.map((s) => {
                  const zerado = semEstoque(s);
                  const critico = isCritico(s);
                  const baixo = s.abaixoMinimo && !critico;
                  return (
                    <tr
                      key={s.productId}
                      onClick={() => setDetalhe(s)}
                      className="group cursor-pointer transition-colors hover:bg-surface-2"
                    >
                      <td className="relative px-4 py-2.5">
                        <span
                          aria-hidden
                          className={cn(
                            "absolute inset-y-0 left-0 w-1",
                            zerado || critico ? "bg-danger" : baixo ? "bg-warn" : "bg-transparent",
                          )}
                        />
                        <ProdutoCell s={s} />
                      </td>
                      <td className="px-4 py-2.5">
                        <StockGauge
                          fechado={s.estoqueFechado}
                          aberto={s.estoqueAberto}
                          conteudoPorUnidade={s.conteudoPorUnidade}
                          minimo={s.estoqueMinimo}
                          ideal={s.estoqueIdeal}
                          fracionavel={s.fracionavel}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <span className={cn(s.abaixoMinimo ? "font-semibold text-warn" : "text-muted")}>
                          {fmt(s.estoqueMinimo)}
                        </span>
                        <span className="text-faint"> / {fmt(s.estoqueIdeal)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                        {s.custoMedio != null ? fmtMoney(s.custoMedio) : <span className="text-faint">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums text-ink">
                        {s.custoMedio != null ? fmtMoney(valorEstoque(s)) : <span className="text-faint">—</span>}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        <ChevronRight size={16} className="ml-auto text-faint transition-colors group-hover:text-ink" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-surface-2 text-xs font-semibold text-muted">
                  <td className="px-4 py-2.5" colSpan={3}>
                    {filtrados.length} {filtrados.length === 1 ? "produto" : "produtos"}
                  </td>
                  <td className="px-4 py-2.5 text-right uppercase tracking-wide text-faint">Total</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="text-sm font-bold tabular-nums text-ink">{fmtMoney(totalValorFiltrado)}</span>
                  </td>
                  <td className="px-2 py-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* ── Cards (mobile) ── */}
          <div className="flex flex-col gap-2.5 md:hidden">
            {filtrados.map((s) => {
              const zerado = semEstoque(s);
              const critico = isCritico(s);
              const baixo = s.abaixoMinimo && !critico;
              return (
                <button
                  key={s.productId}
                  type="button"
                  onClick={() => setDetalhe(s)}
                  className={cn(
                    "relative flex items-center gap-3 overflow-hidden rounded-xl border border-line bg-surface px-3.5 py-3 text-left transition-colors hover:bg-surface-2",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-y-0 left-0 w-1",
                      zerado || critico ? "bg-danger" : baixo ? "bg-warn" : "bg-transparent",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <ProdutoCell s={s} />
                    <div className="mt-2">
                      <StockGauge
                        fechado={s.estoqueFechado}
                        aberto={s.estoqueAberto}
                        conteudoPorUnidade={s.conteudoPorUnidade}
                        minimo={s.estoqueMinimo}
                        ideal={s.estoqueIdeal}
                        fracionavel={s.fracionavel}
                      />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-medium tabular-nums text-ink">
                      {s.custoMedio != null ? fmtMoney(valorEstoque(s)) : "—"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-faint">mín {fmt(s.estoqueMinimo)}</p>
                  </div>
                  <ChevronRight size={16} className="shrink-0 text-faint" />
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ── Drawer de detalhe ── */}
      <DetalheDrawer
        key={detalhe?.productId}
        saldo={detalhe}
        siteId={siteId}
        canRepor={detalhe ? formOptions.products.some((p) => p.id === detalhe.productId) : false}
        onClose={() => setDetalhe(null)}
        onEditar={(id) => router.push(`/produtos/${id}/editar`)}
        onRepor={(s) => { setDetalhe(null); abrirReposicao([s]); }}
        onAjustado={() => { setDetalhe(null); router.refresh(); }}
      />

      {/* ── Sidepanel — reposição ── */}
      <Sheet
        open={reporItems !== null}
        onClose={() => setReporItems(null)}
        title="Repor estoque"
        description="Itens abaixo do mínimo já carregados. Ajuste quantidades e custos."
        width="xl"
      >
        {reporItems && (
          <NovaEntradaForm
            {...formOptions}
            embedded
            initialItems={reporItems}
            onDone={() => setReporItems(null)}
          />
        )}
      </Sheet>
    </div>
  );
}

// ── KPI card ──────────────────────────────────────────────────

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutral",
  active = false,
  onClick,
  action,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "danger" | "warn";
  active?: boolean;
  onClick?: () => void;
  action?: { label: string; onClick: () => void };
}) {
  const toneRing = tone === "danger" ? "ring-danger/40" : tone === "warn" ? "ring-warn/40" : "ring-brand/40";
  const iconCls =
    tone === "danger" ? "bg-danger-soft text-danger"
    : tone === "warn" ? "bg-warn-soft text-warn"
    : "bg-brand-soft text-brand";
  const Wrapper: "button" | "div" = onClick ? "button" : "div";
  return (
    <Wrapper
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 text-left transition-colors",
        onClick && "hover:bg-surface-2",
        active && `ring-2 ${toneRing}`,
      )}
    >
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", iconCls)}>
        <Icon size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
        <p className="font-display text-lg font-semibold leading-tight text-ink tabular-nums">{value}</p>
        {hint && !action && <p className="truncate text-[11px] text-muted">{hint}</p>}
        {action && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); action.onClick(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); action.onClick(); } }}
            className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-warn px-2 py-0.5 text-[11px] font-semibold text-on-brand hover:opacity-90"
          >
            <RefreshCw size={11} /> {action.label}
          </span>
        )}
      </div>
    </Wrapper>
  );
}

// ── Pill de filtro ────────────────────────────────────────────

function FilterPill({
  label,
  count,
  tone,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  count: number;
  tone: "neutral" | "danger" | "warn";
  icon?: React.ElementType;
  active: boolean;
  onClick: () => void;
}) {
  const activeCls =
    tone === "danger" ? "border-danger bg-danger-soft text-danger"
    : tone === "warn" ? "border-warn bg-warn-soft text-warn"
    : "border-brand bg-brand-soft text-brand";
  const badgeCls =
    tone === "danger" ? "bg-danger/15 text-danger"
    : tone === "warn" ? "bg-warn/15 text-warn"
    : "bg-brand/15 text-brand";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active ? activeCls : "border-line text-muted hover:bg-surface-2",
      )}
    >
      {Icon && <Icon size={12} />}
      {label}
      <span className={cn("rounded-full px-1.5 py-px text-[10px] tabular-nums", active ? badgeCls : "bg-surface-2 text-faint")}>
        {count}
      </span>
    </button>
  );
}

// ── Célula de produto (nome + SKU + EAN + chips) ──────────────

function ProdutoCell({ s }: { s: SaldoRow }) {
  const gaps = dataGaps(s);
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <p className="truncate font-medium text-ink">{s.nome}</p>
        {s.tipo === "PERSONALIZADO" && (
          <span className="shrink-0 rounded-full bg-brand-soft px-1.5 py-px text-[10px] font-medium text-brand">
            <Zap size={9} className="-mt-px mr-0.5 inline" />Pers.
          </span>
        )}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
        {s.ean && (
          <span className="flex items-center gap-1 font-mono text-muted">
            <Barcode size={12} className="shrink-0 text-faint" />
            {s.ean}
          </span>
        )}
        <span className="font-mono text-faint">{s.sku}</span>
        {s.locationNome && (
          <span className="flex items-center gap-1 text-faint">
            <Warehouse size={11} className="shrink-0" />
            {s.locationNome}
          </span>
        )}
        {gaps.length > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-warn-soft px-1.5 py-px font-medium text-warn">
            <AlertTriangle size={10} />
            {gaps.length === 1 ? `sem ${gaps[0]}` : `${gaps.length} pendências`}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Cabeçalho ordenável ───────────────────────────────────────

function Th({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: SortDir } | null;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort?.key === sortKey;
  return (
    <th className={cn("px-4 py-2.5", align === "right" && "text-right")}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-ink",
          align === "right" && "flex-row-reverse",
          active && "text-ink",
        )}
      >
        {label}
        {active ? (
          sort!.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />
        ) : (
          <ChevronsUpDown size={12} className="text-faint" />
        )}
      </button>
    </th>
  );
}

// ── Estado vazio ──────────────────────────────────────────────

function EmptyState({ filtro, busca }: { filtro: Filtro; busca: string }) {
  const Icon = filtro === "sem" ? PackageCheck : filtro === "revisar" ? ClipboardList : Boxes;
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-line bg-surface py-14 text-center">
      <Icon size={32} className="text-faint" />
      <p className="text-sm font-medium text-muted">
        {busca
          ? "Nenhum produto encontrado para a busca."
          : filtro === "sem"
            ? "Tudo abastecido — nenhum item zerado."
            : filtro === "revisar"
              ? "Cadastro completo — nenhuma pendência."
              : filtro !== "todos"
                ? "Nenhum produto para este filtro."
                : "Nenhum produto com estoque neste site."}
      </p>
    </div>
  );
}

// ── Drawer de detalhe ─────────────────────────────────────────

type Tab = "resumo" | "historico";

function DetalheDrawer({
  saldo,
  siteId,
  canRepor,
  onClose,
  onEditar,
  onRepor,
  onAjustado,
}: {
  saldo: SaldoRow | null;
  siteId: string | null;
  canRepor: boolean;
  onClose: () => void;
  onEditar: (productId: string) => void;
  onRepor: (s: SaldoRow) => void;
  onAjustado: () => void;
}) {
  const [tab, setTab] = useState<Tab>("resumo");

  useEffect(() => { if (saldo) setTab("resumo"); }, [saldo]);

  const s = saldo;
  const gaps = s ? dataGaps(s) : [];

  return (
    <Sheet
      open={s !== null}
      onClose={onClose}
      title={s?.nome ?? ""}
      description={s ? `${s.sku}${s.ean ? ` · ${s.ean}` : ""}` : ""}
      width="lg"
    >
      {s && (
        <div className="flex flex-col gap-5">
          {/* Tabs */}
          <div className="flex items-center gap-1 rounded-xl border border-line bg-surface-2 p-1">
            {([["resumo", "Resumo"], ["historico", "Histórico"]] as const).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={cn(
                  "flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  tab === k ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
                )}
              >
                {lbl}
              </button>
            ))}
          </div>

          {tab === "resumo" ? (
            <ResumoTab
              s={s}
              siteId={siteId}
              canRepor={canRepor}
              gaps={gaps}
              onEditar={onEditar}
              onRepor={onRepor}
              onAjustado={onAjustado}
            />
          ) : (
            <HistoricoTab productId={s.productId} unidadeBase={s.unidadeBase} siteId={siteId} />
          )}
        </div>
      )}
    </Sheet>
  );
}

function ResumoTab({
  s,
  siteId,
  canRepor,
  gaps,
  onEditar,
  onRepor,
  onAjustado,
}: {
  s: SaldoRow;
  siteId: string | null;
  canRepor: boolean;
  gaps: ("custo" | "fornecedor" | "local")[];
  onEditar: (productId: string) => void;
  onRepor: (s: SaldoRow) => void;
  onAjustado: () => void;
}) {
  const status = semEstoque(s)
    ? { label: "Sem estoque", cls: "bg-danger-soft text-danger", Icon: PackageX }
    : isCritico(s)
      ? { label: "Crítico", cls: "bg-danger-soft text-danger", Icon: AlertOctagon }
      : s.abaixoMinimo
        ? { label: "Abaixo do mínimo", cls: "bg-warn-soft text-warn", Icon: AlertTriangle }
        : { label: "Saudável", cls: "bg-ok-soft text-ok", Icon: PackageCheck };

  return (
    <div className="flex flex-col gap-5">
      {/* Status + medidor */}
      <div className="rounded-xl border border-line bg-surface-2/50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", status.cls)}>
            <status.Icon size={13} /> {status.label}
          </span>
          <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
            {TIPO_LABEL[s.tipo] ?? s.tipo}
          </span>
        </div>
        <StockGauge
          fechado={s.estoqueFechado}
          aberto={s.estoqueAberto}
          conteudoPorUnidade={s.conteudoPorUnidade}
          minimo={s.estoqueMinimo}
          ideal={s.estoqueIdeal}
          fracionavel={s.fracionavel}
        />
      </div>

      {/* Números */}
      <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Fechadas" value={`${fmt(s.estoqueFechado)}`} />
        <Stat label="Mín / Ideal" value={`${fmt(s.estoqueMinimo)} / ${fmt(s.estoqueIdeal)}`} />
        <Stat label="Custo médio" value={s.custoMedio != null ? fmtMoney(s.custoMedio) : "—"} />
        <Stat label="Valor em estoque" value={s.custoMedio != null ? fmtMoney(valorEstoque(s)) : "—"} />
      </dl>

      {gaps.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft/60 px-3 py-2.5 text-xs text-warn">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          <span>
            Cadastro incompleto: <strong>{gaps.join(", ")}</strong>. Complete em editar produto para custo e reposição corretos.
          </span>
        </div>
      )}

      {/* Ações */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onEditar(s.productId)}
          className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
        >
          <Pencil size={14} className="text-muted" /> Editar produto
        </button>
        {canRepor && s.abaixoMinimo && (
          <button
            type="button"
            onClick={() => onRepor(s)}
            className="flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
          >
            <RefreshCw size={14} /> Repor
          </button>
        )}
      </div>

      {/* Ajuste rápido */}
      <AjusteInline s={s} siteId={siteId} onAjustado={onAjustado} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm font-semibold text-ink tabular-nums">{value}</dd>
    </div>
  );
}

// ── Ajuste rápido inline ──────────────────────────────────────

function AjusteInline({
  s,
  siteId,
  onAjustado,
}: {
  s: SaldoRow;
  siteId: string | null;
  onAjustado: () => void;
}) {
  const [aberta, setAberta] = useState(false);
  const [contagem, setContagem] = useState<string>(String(s.estoqueFechado));
  const [motivo, setMotivo] = useState("");
  const [pending, setPending] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const nova = Number(contagem.replace(",", "."));
  const delta = Number.isFinite(nova) ? nova - s.estoqueFechado : 0;
  const podeEnviar = siteId != null && Number.isFinite(nova) && delta !== 0 && motivo.trim().length >= 3 && !pending;

  if (!aberta) {
    return (
      <button
        type="button"
        onClick={() => setAberta(true)}
        className="flex items-center gap-1.5 self-start text-sm font-medium text-brand transition-colors hover:text-brand-strong"
      >
        <SlidersHorizontal size={14} /> Ajustar saldo por contagem
      </button>
    );
  }

  async function salvar() {
    if (!podeEnviar || siteId == null) return;
    setPending(true);
    setErro(null);
    try {
      await registrarAjusteAction({
        siteId,
        productId: s.productId,
        deltaFechado: delta,
        deltaAberto: 0,
        observacao: motivo.trim(),
      });
      onAjustado();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao ajustar.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2/50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">Ajustar saldo por contagem</p>
        <button type="button" onClick={() => setAberta(false)} className="text-xs text-muted hover:text-ink">
          Cancelar
        </button>
      </div>

      {siteId == null ? (
        <p className="text-xs text-muted">Selecione um site específico no topo para ajustar o saldo.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              Contagem física (fechadas)
              <input
                inputMode="decimal"
                value={contagem}
                onChange={(e) => setContagem(e.target.value)}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink tabular-nums focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
              />
            </label>
            <div className="flex flex-col gap-1 text-xs font-medium text-muted">
              Diferença
              <div className={cn(
                "flex h-9.5 items-center rounded-lg border border-line bg-surface px-3 text-sm font-semibold tabular-nums",
                delta > 0 ? "text-ok" : delta < 0 ? "text-danger" : "text-faint",
              )}>
                {delta > 0 ? "+" : ""}{fmt(delta)}
              </div>
            </div>
          </div>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Motivo
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: contagem de prateleira, quebra, divergência"
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
            />
          </label>
          {erro && <p className="text-xs text-danger">{erro}</p>}
          <button
            type="button"
            onClick={salvar}
            disabled={!podeEnviar}
            className="flex items-center justify-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
          >
            {pending ? <Loader2 size={15} className="animate-spin" /> : <SlidersHorizontal size={15} />}
            Salvar ajuste
          </button>
        </>
      )}
    </div>
  );
}

// ── Histórico de movimentações ────────────────────────────────

function HistoricoTab({
  productId,
  unidadeBase,
  siteId,
}: {
  productId: string;
  unidadeBase: string;
  siteId: string | null;
}) {
  const [items, setItems] = useState<HistoricoItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [dias, setDias] = useState<7 | 15 | 30>(7);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    fetchHistoricoProductAction(productId, siteId)
      .then((d) => { if (vivo) setItems(d); })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [productId, siteId]);

  const unidade = unidadeBase.toLowerCase();
  const corte = Date.now() - dias * 24 * 60 * 60 * 1000;
  const visiveis = (items ?? []).filter((m) => new Date(m.createdAt).getTime() >= corte);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1.5">
        {([7, 15, 30] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDias(d)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              dias === d ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:bg-surface-2",
            )}
          >
            {d === 7 ? "Última semana" : `${d} dias`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin text-faint" />
        </div>
      ) : visiveis.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <History size={32} className="text-faint" />
          <p className="text-sm font-medium text-muted">Nenhuma movimentação nos últimos {dias} dias.</p>
        </div>
      ) : (
        <ol className="flex flex-col gap-px">
          {visiveis.map((m, i) => {
            const meta = TIPO_MOV[m.tipo] ?? { label: m.tipo, cor: "text-muted" };
            const positivoF = m.deltaFechado > 0;
            const positivoA = m.deltaAberto > 0;
            return (
              <li
                key={m.id}
                className={cn("flex items-start gap-3 rounded-md px-3 py-2.5", i % 2 === 0 ? "bg-surface" : "bg-surface-2/50")}
              >
                <span className={cn("mt-0.5 shrink-0", meta.cor)}>
                  <MovIcon tipo={m.tipo} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className={cn("text-sm font-semibold", meta.cor)}>{getMovLabel(m)}</span>
                    <time className="text-[11px] tabular-nums text-faint">{fmtDateTime(m.createdAt)}</time>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                    {m.deltaFechado !== 0 && (
                      <span className={cn("font-semibold tabular-nums", positivoF ? "text-ok" : "text-danger")}>
                        {positivoF ? "+" : ""}{fmt(m.deltaFechado)} un
                      </span>
                    )}
                    {m.deltaAberto !== 0 && (
                      <span className={cn("tabular-nums", positivoA ? "text-ok" : "text-danger")}>
                        {positivoA ? "+" : ""}{fmt(m.deltaAberto)} {unidade}
                      </span>
                    )}
                    {m.custoUnitario != null && (
                      <span className="text-muted">
                        Valor: <span className="font-medium text-ink">
                          {fmtMoney(m.custoUnitario * Math.abs(m.deltaFechado || m.deltaAberto || 1))}
                        </span>
                      </span>
                    )}
                  </div>
                  {getMovSub(m) && <p className="mt-0.5 text-[11px] font-medium text-muted">{getMovSub(m)}</p>}
                  {m.observacao && <p className="mt-0.5 text-[11px] italic text-muted">{m.observacao}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/* Ícone por tipo de movimento */
function MovIcon({ tipo }: { tipo: string }) {
  switch (tipo) {
    case "ENTRADA":       return <ArrowDown size={16} />;
    case "SAIDA":         return <ArrowUp size={16} />;
    case "AJUSTE":        return <SlidersHorizontal size={15} />;
    case "TRANSFERENCIA": return <ArrowLeftRight size={15} />;
    case "ABERTURA":      return <PackageOpen size={15} />;
    case "PRODUCAO":      return <Zap size={14} />;
    case "PERDA":         return <AlertTriangle size={15} />;
    case "DEVOLUCAO_CLIENTE":    return <ArrowDown size={16} />;
    case "DEVOLUCAO_FORNECEDOR": return <ArrowUp size={16} />;
    default:              return <History size={14} />;
  }
}
