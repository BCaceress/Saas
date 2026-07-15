"use client";

import { useMemo, useState, useEffect, useId, useRef, type ComponentProps } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Search,
  Boxes,
  Download,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  History,
  ArrowLeftRight,
  Zap,
  SlidersHorizontal,
  Loader2,
  PackageX,
  PackageOpen,
  PackageCheck,
  Package,
  Pencil,
  Wallet,
  MapPin,
  ClipboardList,
  Info,
  Filter,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import { Menu, MenuItem } from "@/components/ui/menu";
import { NovaEntradaForm, type Item } from "../entradas/nova/_client";
import type { SaldoRow } from "../_data";
import { fetchHistoricoProductAction, registrarAjusteAction, fetchEntradaFormDataAction } from "../actions";

const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const fmt1 = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
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
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Tempo relativo curto: "agora", "há 15 min", "ontem", "há 3 dias". */
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ontem";
  if (d < 30) return `há ${d} dias`;
  const mo = Math.floor(d / 30);
  return mo === 1 ? "há 1 mês" : `há ${mo} meses`;
}

/** Data de previsão em linguagem operacional: "hoje", "amanhã", "em 12/07". */
function previsaoLabel(iso: string): string {
  const d = new Date(iso); d.setHours(0, 0, 0, 0);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const dias = Math.round((d.getTime() - t.getTime()) / 864e5);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "amanhã";
  return `em ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
}

const MOV_SHORT: Record<string, string> = {
  SAIDA: "Venda", ENTRADA: "Compra", AJUSTE: "Ajuste", TRANSFERENCIA: "Transferência",
  ABERTURA: "Abertura", PRODUCAO: "Produção", PERDA: "Perda",
  DEVOLUCAO_CLIENTE: "Devolução", DEVOLUCAO_FORNECEDOR: "Devolução",
};

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

const PURCHASE_MOTIVO_LABEL: Record<string, string> = {
  COMPRA_SEM_PEDIDO: "Entrada manual",
  BONIFICACAO: "Bonificação",
  ESTOQUE_INICIAL: "Estoque inicial",
  TRANSFERENCIA: "Transferência",
};

function getMovLabel(m: HistoricoItem): string {
  if (m.tipo === "SAIDA" && m.saleOrigem) return SALE_ORIGEM_LABEL[m.saleOrigem] ?? "Saída";
  if (m.tipo === "ENTRADA") {
    if (m.purchaseMotivo) {
      const label = PURCHASE_MOTIVO_LABEL[m.purchaseMotivo] ?? m.purchaseMotivo;
      return m.purchaseMotivo === "COMPRA_SEM_PEDIDO" ? label : `Entrada — ${label}`;
    }
    if (m.purchaseTipo === "FORNECEDOR") return "Entrada — Fornecedor";
    return "Entrada — Manual";
  }
  return TIPO_MOV[m.tipo]?.label ?? m.tipo;
}

function getMovSub(m: HistoricoItem): string | null {
  if (m.tipo === "ENTRADA" && !m.purchaseMotivo && m.purchaseTipo === "FORNECEDOR" && m.purchaseSupplier) {
    return m.purchaseSupplier;
  }
  if (m.tipo === "PRODUCAO" && m.producaoDrinkNome) {
    return `Drink: ${m.producaoDrinkNome}`;
  }
  return null;
}

type Filtro = "todos" | "sem" | "baixoMinimo" | "repor" | "pendencias";
type SortKey = "nome" | "fechado" | "valor";
type SortDir = "asc" | "desc";
type FormOptions = Pick<ComponentProps<typeof NovaEntradaForm>, "products" | "sites">;
type HistoricoItem = Awaited<ReturnType<typeof fetchHistoricoProductAction>>[number];

// ── Situação do estoque ───────────────────────────────────────
// Estados objetivos: fechado × mínimo × ideal (+ aberto p/ distinguir zerado real).
// Sem mín. e sem ideal configurados ⇒ não dá pra calcular corretamente ("Meta não definida").

type Status = "semEstoque" | "semMeta" | "baixoMinimo" | "baixoIdeal" | "abastecido";

function statusOf(s: SaldoRow): Status {
  const f = s.estoqueFechado;
  if (f <= 0 && s.estoqueAberto <= 0) return "semEstoque";
  const { estoqueMinimo: min, estoqueIdeal: ideal } = s;
  if (min <= 0 && ideal <= 0) return "semMeta";
  if (min > 0 && f < min) return "baixoMinimo";
  if (ideal > 0 && f < ideal) return "baixoIdeal";
  return "abastecido";
}

const STATUS_META: Record<Status, { label: string; text: string; dot: string; bar: string; Icon: React.ElementType }> = {
  abastecido:  { label: "Abastecido",       text: "text-ok",     dot: "bg-ok",     bar: "bg-ok",     Icon: PackageCheck },
  baixoIdeal:  { label: "Abaixo do ideal",  text: "text-warn",   dot: "bg-warn",   bar: "bg-warn",   Icon: AlertTriangle },
  baixoMinimo: { label: "Abaixo do mínimo", text: "text-brand",  dot: "bg-brand",  bar: "bg-brand",  Icon: AlertTriangle },
  semEstoque:  { label: "Sem estoque",      text: "text-danger", dot: "bg-danger", bar: "bg-danger", Icon: PackageX },
  semMeta:     { label: "Meta não definida",text: "text-faint",  dot: "bg-faint",  bar: "bg-faint",  Icon: PackageX },
};

const semEstoque = (s: SaldoRow) => statusOf(s) === "semEstoque";
const abaixoMin = (s: SaldoRow) => s.estoqueMinimo > 0 && s.estoqueFechado < s.estoqueMinimo;
const precisaRepor = (s: SaldoRow) => s.estoqueIdeal > 0 && s.estoqueFechado < s.estoqueIdeal;
const valorEstoque = (s: SaldoRow) => s.estoqueFechado * (s.custoMedio ?? 0);
const disponivel = (s: SaldoRow) => s.estoqueFechado - s.estoqueAberto;

/** Média diária de vendas (prioriza 7d, cai p/ 30d). 0 = sem giro. */
const mediaDia = (s: SaldoRow) =>
  s.consumo7 > 0 ? s.consumo7 / 7 : s.consumo30 > 0 ? s.consumo30 / 30 : 0;

/** Dias de cobertura = saldo fechado ÷ média diária. null = sem giro. */
function diasCobertura(s: SaldoRow): number | null {
  const m = mediaDia(s);
  if (m <= 0) return null;
  return Math.max(0, Math.round(s.estoqueFechado / m));
}

/** Lacunas de cadastro que atrapalham operação (custo, fornecedor, localização). */
function dataGaps(s: SaldoRow): ("custo" | "fornecedor" | "local")[] {
  const g: ("custo" | "fornecedor" | "local")[] = [];
  if (s.custoMedio == null) g.push("custo");
  if (!s.temFornecedor) g.push("fornecedor");
  if (!s.locationNome) g.push("local");
  return g;
}

const PRIORITY: Record<Status, number> = { semEstoque: 0, baixoMinimo: 1, baixoIdeal: 2, semMeta: 3, abastecido: 4 };

/* CSV: separador ";" e decimal com vírgula (Excel pt-BR). */
function toCsv(rows: SaldoRow[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3, useGrouping: false });
  const head = ["Produto", "Tipo", "SKU", "Codigo de barras", "Categoria", "Marca", "Fornecedor", "Fechado", "Aberto", "Disponivel", "Minimo", "Ideal", "Custo medio", "Valor em estoque", "Local"];
  const body = rows.map((s) => [
    esc(s.nome),
    esc(TIPO_LABEL[s.tipo] ?? s.tipo),
    esc(s.sku),
    esc(s.ean ?? ""),
    esc(s.categoria ?? ""),
    esc(s.marca ?? ""),
    esc(s.fornecedorNome ?? ""),
    num(s.estoqueFechado),
    num(s.estoqueAberto),
    num(disponivel(s)),
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

type Tab = "resumo" | "historico";

export function SaldosView({
  saldos,
  siteId,
}: {
  saldos: SaldoRow[];
  siteId: string | null;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);
  const [reporItems, setReporItems] = useState<Item[] | null>(null);
  const [reporLoading, setReporLoading] = useState(false);
  const [detalhe, setDetalhe] = useState<{ row: SaldoRow; tab: Tab } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Opções do form de reposição: carregadas sob demanda (1ª vez) e cacheadas —
  // evita puxar todos os produtos/fornecedores no carregamento da página.
  const [formOptions, setFormOptions] = useState<FormOptions | null>(null);
  const formOptionsPromise = useRef<Promise<FormOptions> | null>(null);
  function ensureFormOptions(): Promise<FormOptions> {
    if (!formOptionsPromise.current) {
      formOptionsPromise.current = fetchEntradaFormDataAction().then((d) => {
        setFormOptions(d);
        return d;
      });
    }
    return formOptionsPromise.current;
  }

  const abrir = (row: SaldoRow, tab: Tab = "resumo") => setDetalhe({ row, tab });

  const kpis = useMemo(() => {
    let valor = 0, sem = 0, repor = 0, abaixo = 0;
    for (const s of saldos) {
      valor += valorEstoque(s);
      if (semEstoque(s)) sem++;
      if (abaixoMin(s)) abaixo++;
      if (precisaRepor(s)) repor++;
    }
    return { valor, sem, abaixo, repor, total: saldos.length };
  }, [saldos]);

  const counts = useMemo(() => {
    let sem = 0, baixoMinimo = 0, repor = 0, semlocal = 0, pendencias = 0, comEstoque = 0, semMeta = 0;
    for (const s of saldos) {
      if (!semEstoque(s)) comEstoque++; else sem++;
      if (abaixoMin(s)) baixoMinimo++;
      if (precisaRepor(s)) repor++;
      if (!s.locationNome) semlocal++;
      if (dataGaps(s).length > 0) pendencias++;
      if (statusOf(s) === "semMeta") semMeta++;
    }
    return { todos: saldos.length, sem, baixoMinimo, repor, semlocal, pendencias, comEstoque, semMeta };
  }, [saldos]);

  // Filtros secundários (painel "Filtros") — categoria/fornecedor/local derivados dos dados.
  const [avComEstoque, setAvComEstoque] = useState(false);
  const [avSemLocal, setAvSemLocal] = useState(false);
  const [avSemMeta, setAvSemMeta] = useState(false);
  const [avCategoria, setAvCategoria] = useState("");
  const [avFornecedor, setAvFornecedor] = useState("");
  const [avLocal, setAvLocal] = useState("");

  const categorias = useMemo(
    () => [...new Set(saldos.map((s) => s.categoria).filter((v): v is string => !!v))].sort(),
    [saldos],
  );
  const fornecedores = useMemo(
    () => [...new Set(saldos.map((s) => s.fornecedorNome).filter((v): v is string => !!v))].sort(),
    [saldos],
  );
  const locais = useMemo(
    () => [...new Set(saldos.map((s) => s.locationNome).filter((v): v is string => !!v))].sort(),
    [saldos],
  );

  const avancadoAtivo = avComEstoque || avSemLocal || avSemMeta || !!avCategoria || !!avFornecedor || !!avLocal;
  function limparAvancado() {
    setAvComEstoque(false);
    setAvSemLocal(false);
    setAvSemMeta(false);
    setAvCategoria("");
    setAvFornecedor("");
    setAvLocal("");
  }

  const filtrados = useMemo(() => {
    const termo = q.trim().toLowerCase();
    const out = saldos.filter((s) => {
      switch (filtro) {
        case "sem":         if (!semEstoque(s)) return false; break;
        case "baixoMinimo": if (!abaixoMin(s)) return false; break;
        case "repor":       if (!precisaRepor(s)) return false; break;
        case "pendencias":  if (dataGaps(s).length === 0) return false; break;
      }
      if (avComEstoque && semEstoque(s)) return false;
      if (avSemLocal && s.locationNome) return false;
      if (avSemMeta && statusOf(s) !== "semMeta") return false;
      if (avCategoria && s.categoria !== avCategoria) return false;
      if (avFornecedor && s.fornecedorNome !== avFornecedor) return false;
      if (avLocal && s.locationNome !== avLocal) return false;
      if (termo) {
        const alvo = `${s.nome} ${s.sku} ${s.ean ?? ""} ${s.categoria ?? ""} ${s.marca ?? ""} ${s.fornecedorNome ?? ""}`.toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      return true;
    });

    out.sort((a, b) => {
      const pa = PRIORITY[statusOf(a)], pb = PRIORITY[statusOf(b)];
      if (pa !== pb) return pa - pb;
      if (sort) {
        const f = (s: SaldoRow) =>
          sort.key === "nome" ? s.nome.toLowerCase()
          : sort.key === "fechado" ? s.estoqueFechado
          : valorEstoque(s);
        const va = f(a), vb = f(b);
        const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
        return sort.dir === "asc" ? cmp : -cmp;
      }
      return a.nome.localeCompare(b.nome);
    });

    return out;
  }, [saldos, q, filtro, sort, avComEstoque, avSemLocal, avSemMeta, avCategoria, avFornecedor, avLocal]);

  // Paginação — volta à 1ª página quando o conjunto muda.
  useEffect(() => { setPage(1); }, [q, filtro, sort, pageSize, avComEstoque, avSemLocal, avSemMeta, avCategoria, avFornecedor, avLocal]);
  const total = filtrados.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const inicio = (pageSafe - 1) * pageSize;
  const pageRows = filtrados.slice(inicio, inicio + pageSize);

  function toggleSort(key: SortKey) {
    setSort((cur) =>
      cur?.key === key
        ? cur.dir === "asc" ? { key, dir: "desc" } : null
        : { key, dir: "asc" },
    );
  }

  async function abrirReposicao(scope: SaldoRow[]) {
    setReporLoading(true);
    try {
      const opts = await ensureFormOptions();
      const productIds = new Set(opts.products.map((p) => p.id));
      const items: Item[] = scope
        .filter((s) => precisaRepor(s) && productIds.has(s.productId))
        .map((s) => {
          const deficit = s.estoqueIdeal - s.estoqueFechado;
          const prod = opts.products.find((p) => p.id === s.productId);
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
    } finally {
      setReporLoading(false);
    }
  }

  /** Nova movimentação a partir do sidepanel de detalhe — prefila este produto, sem exigir déficit. */
  async function abrirNovaMovimentacao(s: SaldoRow) {
    setReporLoading(true);
    try {
      const opts = await ensureFormOptions();
      const prod = opts.products.find((p) => p.id === s.productId);
      const padrao = prod?.packagings.find((pk) => pk.isCompraDefault);
      setReporItems([
        prod
          ? { productId: prod.id, quantidade: 1, custoTotal: 0, custoDisplay: "", packagingId: padrao?.id ?? null }
          : { productId: "", quantidade: 1, custoTotal: 0, custoDisplay: "", packagingId: null },
      ]);
    } finally {
      setReporLoading(false);
    }
  }

  type Pill = { key: Filtro; label: string; count: number; tone: "neutral" | "danger" | "warn" | "brand" };
  // Chips visíveis: só os 5 estados objetivos do resultado esperado. O resto
  // (com estoque, sem localização, sem meta, categoria/fornecedor/local) mora no menu "Filtros".
  const pillsEstoque: Pill[] = [
    { key: "todos",       label: "Todos",           count: counts.todos,       tone: "neutral" },
    { key: "sem",         label: "Sem estoque",     count: counts.sem,         tone: "danger"  },
    { key: "baixoMinimo", label: "Abaixo do mínimo", count: counts.baixoMinimo, tone: "brand"   },
    { key: "repor",       label: "A repor",         count: counts.repor,       tone: "warn"    },
    { key: "pendencias",  label: "Pendências",      count: counts.pendencias,  tone: "warn"    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* ── Indicadores ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={Wallet}
          label="Valor em estoque"
          value={fmtMoneyShort(kpis.valor)}
          hint={`${kpis.total} ${kpis.total === 1 ? "produto" : "produtos"}`}
        />
        <Kpi
          icon={PackageX}
          label="Sem estoque"
          value={String(kpis.sem)}
          tone="danger"
          selected={filtro === "sem"}
          onClick={() => setFiltro(filtro === "sem" ? "todos" : "sem")}
          hint="Indisponíveis para venda"
        />
        <Kpi
          icon={AlertTriangle}
          label="Abaixo do mínimo"
          value={String(kpis.abaixo)}
          tone="danger"
          selected={filtro === "baixoMinimo"}
          onClick={() => setFiltro(filtro === "baixoMinimo" ? "todos" : "baixoMinimo")}
          hint="Requerem atenção"
        />
        <Kpi
          icon={RefreshCw}
          label="A repor"
          value={String(kpis.repor)}
          tone="warn"
          selected={filtro === "repor"}
          onClick={() => setFiltro(filtro === "repor" ? "todos" : "repor")}
          hint="Precisam de reposição"
        />
      </div>

      {/* ── Barra de ações: busca + filtros ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full shrink-0 sm:max-w-lg">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome, SKU, código, categoria, marca ou fornecedor…"
            className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-faint focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex flex-1 items-center gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {pillsEstoque.map((p) => (
              <FilterPill
                key={p.key}
                label={p.label}
                count={p.count}
                active={filtro === p.key}
                onClick={() => setFiltro(filtro === p.key ? "todos" : p.key)}
              />
            ))}
          </div>
          <Menu
            align="end"
            className="w-72"
            trigger={
              <button
                type="button"
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                  avancadoAtivo
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-2",
                )}
              >
                <Filter size={15} className={avancadoAtivo ? "text-brand" : "text-muted"} />
                <span>Filtros</span>
              </button>
            }
          >
            <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-faint">Estoque</p>
            <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-2">
              <input type="checkbox" checked={avComEstoque} onChange={(e) => setAvComEstoque(e.target.checked)} className="accent-brand" />
              Com estoque
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-2">
              <input type="checkbox" checked={avSemLocal} onChange={(e) => setAvSemLocal(e.target.checked)} className="accent-brand" />
              Sem localização
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-sm text-ink transition-colors hover:bg-surface-2">
              <input type="checkbox" checked={avSemMeta} onChange={(e) => setAvSemMeta(e.target.checked)} className="accent-brand" />
              Sem meta definida
            </label>

            {(categorias.length > 0 || fornecedores.length > 0 || locais.length > 0) && (
              <>
                <div className="my-1.5 h-px bg-line" />
                <div className="flex flex-col gap-2 px-2.5 py-1">
                  {categorias.length > 0 && (
                    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                      Categoria
                      <select
                        value={avCategoria}
                        onChange={(e) => setAvCategoria(e.target.value)}
                        className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
                      >
                        <option value="">Todas</option>
                        {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </label>
                  )}
                  {fornecedores.length > 0 && (
                    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                      Fornecedor
                      <select
                        value={avFornecedor}
                        onChange={(e) => setAvFornecedor(e.target.value)}
                        className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
                      >
                        <option value="">Todos</option>
                        {fornecedores.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </label>
                  )}
                  {locais.length > 0 && (
                    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                      Local
                      <select
                        value={avLocal}
                        onChange={(e) => setAvLocal(e.target.value)}
                        className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
                      >
                        <option value="">Todos</option>
                        {locais.map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              </>
            )}

            <div className="my-1.5 h-px bg-line" />
            <MenuItem
              icon={<Download size={15} />}
              onClick={() => baixarCsv(filtrados)}
              disabled={filtrados.length === 0}
            >
              Exportar CSV
            </MenuItem>
            {(filtro !== "todos" || q.trim() !== "" || avancadoAtivo) && (
              <MenuItem icon={<X size={15} />} onClick={() => { setFiltro("todos"); setQ(""); limparAvancado(); }}>
                Limpar filtros
              </MenuItem>
            )}
          </Menu>
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
                  <th className="px-4 py-2">Situação</th>
                  <Th label="Estoque" sortKey="fechado" sort={sort} onSort={toggleSort} />
                  <th className="hidden px-4 py-2 lg:table-cell">
                    <span className="inline-flex items-center gap-1" title="Conteúdo restante da unidade aberta, vendida em doses/drinks">
                      Aberto (consumo/drinks)
                      <Info size={12} className="text-faint" aria-label="Conteúdo restante da unidade aberta, vendida em doses/drinks" />
                    </span>
                  </th>
                  <th className="hidden px-4 py-2 md:table-cell">Reposição</th>
                  <th className="w-px px-3 py-2" aria-hidden />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pageRows.map((s) => {
                  const st = statusOf(s);
                  return (
                    <tr
                      key={s.productId}
                      onClick={() => abrir(s)}
                      className="group cursor-pointer transition-colors hover:bg-surface-2"
                    >
                      <td className="px-4 py-2">
                        <ProdutoCell s={s} onPendencias={() => router.push(`/produtos/${s.productId}/editar`)} />
                      </td>
                      <td className="px-4 py-2">
                        <StatusCell status={st} />
                      </td>
                      <td className="px-4 py-2">
                        <EstoqueCell s={s} />
                      </td>
                      <td className="hidden px-4 py-2 lg:table-cell">
                        <AbertaCell s={s} />
                      </td>
                      <td className="hidden px-4 py-2 md:table-cell">
                        <ReposicaoStatusCell s={s} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <ChevronRight size={16} className="ml-auto shrink-0 text-faint transition-colors group-hover:text-ink" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-surface-2 text-xs font-semibold text-muted">
                  <td className="px-4 py-2" colSpan={3}>
                    {total} {total === 1 ? "produto" : "produtos"}
                  </td>
                  <td className="hidden px-4 py-2 lg:table-cell" />
                  <td className="hidden px-4 py-2 md:table-cell" />
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* ── Cards (mobile) ── */}
          <div className="flex flex-col gap-2.5 md:hidden">
            {pageRows.map((s) => {
              const st = statusOf(s);
              return (
                <div
                  key={s.productId}
                  role="button"
                  tabIndex={0}
                  onClick={() => abrir(s)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(s); } }}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <ProdutoCell s={s} onPendencias={() => router.push(`/produtos/${s.productId}/editar`)} />
                      <StatusCell status={st} compact />
                    </div>
                    <div className="mt-2 flex items-end justify-between gap-3">
                      <EstoqueCell s={s} />
                      <div className="shrink-0 text-right">
                        <ReposicaoStatusCell s={s} />
                      </div>
                    </div>
                    {temAbertaFrac(s) && (
                      <div className="mt-1.5">
                        <AbertaCell s={s} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <PaginationBar
            total={total}
            inicio={inicio}
            mostrando={pageRows.length}
            page={pageSafe}
            totalPages={totalPages}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={setPageSize}
          />
        </>
      )}

      {/* ── Drawer de detalhe ── */}
      <DetalheDrawer
        key={detalhe?.row.productId}
        saldo={detalhe?.row ?? null}
        initialTab={detalhe?.tab ?? "resumo"}
        siteId={siteId}
        canRepor={detalhe ? ["SIMPLES", "INSUMO"].includes(detalhe.row.tipo) : false}
        onClose={() => setDetalhe(null)}
        onEditar={(id) => router.push(`/produtos/${id}/editar`)}
        onRepor={(s) => { setDetalhe(null); abrirReposicao([s]); }}
        onNovaMovimentacao={(s) => { setDetalhe(null); abrirNovaMovimentacao(s); }}
        onAjustado={() => { setDetalhe(null); router.refresh(); }}
      />

      {/* ── Sidepanel — reposição ── */}
      <Sheet
        open={reporItems !== null || reporLoading}
        onClose={() => setReporItems(null)}
        title="Repor estoque"
        description="Itens abaixo do ideal já carregados. Ajuste quantidades e custos."
        width="xl"
      >
        {reporItems && formOptions ? (
          <NovaEntradaForm
            {...formOptions}
            motivo="COMPRA_SEM_PEDIDO"
            embedded
            initialItems={reporItems}
            onDone={() => setReporItems(null)}
          />
        ) : (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={20} className="animate-spin text-faint" />
          </div>
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
  selected = false,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "danger" | "warn";
  selected?: boolean;
  onClick?: () => void;
}) {
  const iconWrap =
    tone === "danger" ? "bg-danger-soft text-danger"
    : tone === "warn" ? "bg-warn-soft text-warn"
    : "bg-brand-soft text-brand";
  const valueCls =
    tone === "danger" ? "text-danger"
    : tone === "warn" ? "text-warn"
    : "text-ink";
  const Wrapper: "button" | "div" = onClick ? "button" : "div";
  return (
    <Wrapper
      {...(onClick ? { type: "button" as const, onClick, "aria-pressed": selected } : {})}
      className={cn(
        "flex flex-col gap-2.5 rounded-2xl border bg-surface p-4 text-left transition-all",
        selected ? "border-brand ring-1 ring-brand/30" : "border-line",
        onClick && !selected && "hover:border-line-strong hover:shadow-sm",
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-xl", iconWrap)}>
          <Icon size={16} strokeWidth={2} />
        </span>
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      </div>
      <div>
        <p className={cn("font-display text-2xl font-bold leading-none tabular-nums", valueCls)}>{value}</p>
        {hint && <p className="mt-1.5 truncate text-[11px] text-faint">{hint}</p>}
      </div>
    </Wrapper>
  );
}

// ── Pill de filtro ────────────────────────────────────────────

function FilterPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  // Contorno discreto; ativo destaca em laranja (brand) sem preenchimento sólido.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-brand bg-brand-soft text-brand"
          : "border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-2",
      )}
    >
      {label}
      <span
        className={cn(
          "min-w-5 rounded-md px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums",
          active ? "bg-brand/15 text-brand" : "bg-surface-2 text-muted",
        )}
      >
        {count}
      </span>
    </button>
  );
}

// ── Paginação ─────────────────────────────────────────────────

function PaginationBar({
  total,
  inicio,
  mostrando,
  page,
  totalPages,
  pageSize,
  onPage,
  onPageSize,
}: {
  total: number;
  inicio: number;
  mostrando: number;
  page: number;
  totalPages: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
}) {
  return (
    <div className="flex flex-col-reverse items-center justify-between gap-3 sm:flex-row">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>
          {total === 0 ? "0" : `${inicio + 1}–${inicio + mostrando}`} de{" "}
          <span className="font-semibold text-ink tabular-nums">{total}</span> {total === 1 ? "produto" : "produtos"}
        </span>
        <span className="h-3.5 w-px bg-line" aria-hidden />
        <label className="flex items-center gap-1.5">
          <span className="hidden sm:inline">Por página</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPage(page - 1)}
            disabled={page <= 1}
            className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
            aria-label="Página anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="px-2 text-xs font-medium tabular-nums text-muted">
            {page} <span className="text-faint">/ {totalPages}</span>
          </span>
          <button
            type="button"
            onClick={() => onPage(page + 1)}
            disabled={page >= totalPages}
            className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
            aria-label="Próxima página"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Miniatura do produto ──────────────────────────────────────

function Thumb({ url, size = 38 }: { url: string | null; size?: number }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className="shrink-0 rounded-lg border border-line object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <div
      className="grid shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-faint"
      style={{ width: size, height: size }}
    >
      <Package size={Math.round(size * 0.48)} />
    </div>
  );
}

// ── Situação (dot + rótulo) ───────────────────────────────────

function StatusCell({ status, compact = false }: { status: Status; compact?: boolean }) {
  const m = STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", m.dot)} />
      {!compact && <span className={cn("text-xs font-medium", m.text)}>{m.label}</span>}
    </span>
  );
}

// ── Célula de estoque (qtd fechada + barra rumo ao ideal, com mínimo) ─

/** Rótulo da unidade do saldo fechado. Fracionável conta em pacotes ("un"). */
function closedUnitLabel(s: SaldoRow): string {
  return s.fracionavel ? "un" : s.unidadeBase.toLowerCase();
}

/** Tem unidade aberta fracionável mensurável (ex.: garrafa pela metade). */
function temAbertaFrac(s: SaldoRow): boolean {
  return s.fracionavel && !!s.conteudoPorUnidade && s.conteudoPorUnidade > 0 && s.estoqueAberto > 0;
}

function EstoqueCell({ s }: { s: SaldoRow }) {
  const st = statusOf(s);
  const m = STATUS_META[st];
  const { estoqueFechado: f, estoqueIdeal: ideal, estoqueMinimo: min } = s;
  const pct = ideal > 0 ? Math.round((f / ideal) * 100) : f > 0 ? 100 : 0;
  const fill = Math.min(100, Math.max(0, pct));
  const minPos = ideal > 0 && min > 0 ? Math.min(100, (min / ideal) * 100) : null;

  const cob = diasCobertura(s);
  return (
    <div className="flex w-40 max-w-full flex-col gap-1">
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-sm font-semibold tabular-nums text-ink">{fmt(f)}</span>
        <span className="text-[11px] text-muted">{closedUnitLabel(s)}</span>
        {cob != null && (
          <span className="ml-auto text-[11px] font-medium tabular-nums text-muted" title="Cobertura estimada pela média de vendas">
            ≈ {cob} {cob === 1 ? "dia" : "dias"}
          </span>
        )}
      </div>
      {/* Barra: progresso rumo ao ideal, com marcador do mínimo */}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-line ring-1 ring-inset ring-line">
        <div className={cn("h-full rounded-full transition-all", m.bar)} style={{ width: `${fill}%` }} />
        {minPos != null && (
          <span
            aria-hidden
            title="Estoque mínimo"
            className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink/60"
            style={{ left: `${minPos}%` }}
          />
        )}
      </div>
      {ideal > 0 ? (
        <div className="flex justify-between text-[10px] tabular-nums text-faint">
          <span>mín {fmt(min)}</span>
          <span>ideal {fmt(ideal)}</span>
        </div>
      ) : (
        <span className="text-[10px] text-faint">sem meta definida</span>
      )}
    </div>
  );
}

// ── Célula de unidade aberta (garrafa + nível de consumo) ─────

/** Volume legível: ml vira "L" quando ≥ 1000. Ex.: 750→"750 ml", 1000→"1 L". */
function fmtVol(v: number, un: string): string {
  if (un === "ml" && v >= 1000) {
    return `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} L`;
  }
  return `${fmt(v)} ${un}`;
}

/** Silhueta de garrafa, com líquido preenchendo o corpo conforme o nível. */
function GarrafaIcon({ pct }: { pct: number }) {
  const bodyTop = 9;      // y do topo do corpo
  const bodyBottom = 28;  // y da base
  const level = bodyBottom - ((bodyBottom - bodyTop) * Math.min(100, Math.max(0, pct))) / 100;
  const clipId = `g${useId().replace(/:/g, "")}`;
  return (
    <svg width="20" height="30" viewBox="0 0 20 30" fill="none" className="shrink-0" aria-hidden>
      <defs>
        <clipPath id={clipId}>
          <path d="M8 1.5h4v3.4c0 .9.5 1.3 1.3 2 .9.8 1.7 1.7 1.7 3.3v15.3a2.5 2.5 0 0 1-2.5 2.5H7.5A2.5 2.5 0 0 1 5 27.5V10.2c0-1.6.8-2.5 1.7-3.3.8-.7 1.3-1.1 1.3-2z" />
        </clipPath>
      </defs>
      {/* líquido */}
      <rect x="0" y={level} width="20" height={30 - level} className="fill-accent/25" clipPath={`url(#${clipId})`} />
      {/* contorno */}
      <path
        d="M8 1.5h4v3.4c0 .9.5 1.3 1.3 2 .9.8 1.7 1.7 1.7 3.3v15.3a2.5 2.5 0 0 1-2.5 2.5H7.5A2.5 2.5 0 0 1 5 27.5V10.2c0-1.6.8-2.5 1.7-3.3.8-.7 1.3-1.1 1.3-2z"
        className="stroke-faint"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AbertaCell({ s }: { s: SaldoRow }) {
  if (!temAbertaFrac(s)) {
    return <span className="text-[11px] text-faint">—</span>;
  }
  const a = s.estoqueAberto;
  const cpu = s.conteudoPorUnidade!;
  const un = s.unidadeBase.toLowerCase();
  const pct = Math.min(100, Math.round((a / cpu) * 100));
  return (
    <div className="flex items-center gap-2.5">
      <GarrafaIcon pct={pct} />
      <div className="min-w-0 leading-tight">
        <span className="whitespace-nowrap text-[13px] tabular-nums">
          <span className="font-semibold text-accent">{fmtVol(a, un)}</span>
          <span className="text-muted"> de {fmtVol(cpu, un)}</span>
        </span>
        {s.abertaEm && (
          <p className="mt-0.5 text-[11px] text-faint">Aberta em {fmtDate(s.abertaEm)}</p>
        )}
      </div>
    </div>
  );
}

// ── Célula de próxima reposição (pedido de compra em aberto) ───

/** Badge com dot colorido. */
function ReposBadge({ tone, children }: { tone: "ok" | "warn" | "danger" | "muted"; children: React.ReactNode }) {
  const text = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "text-faint";
  const dot = tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : tone === "danger" ? "bg-danger" : "bg-faint";
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium", text)}>
      <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
      {children}
    </span>
  );
}

/**
 * Reposição responde "o que preciso fazer?" — separado da situação física do
 * estoque. Comprar hoje/Sem reposição só se aplicam quando falta comprar e
 * não há pedido em aberto; havendo pedido, o que importa é a previsão.
 */
function ReposicaoStatusCell({ s }: { s: SaldoRow }) {
  if (s.reposEstado === "prevista") {
    return (
      <ReposBadge tone="ok">
        Próxima compra {s.reposPrevisao ? previsaoLabel(s.reposPrevisao) : ""}
      </ReposBadge>
    );
  }
  if (s.reposEstado === "pedido") {
    return <ReposBadge tone="ok">Próxima compra — pedido enviado</ReposBadge>;
  }
  if (!precisaRepor(s)) {
    return <ReposBadge tone="muted">Não necessário</ReposBadge>;
  }
  const st = statusOf(s);
  if (st === "semEstoque" || st === "baixoMinimo") {
    return <ReposBadge tone="danger">Comprar hoje</ReposBadge>;
  }
  return <ReposBadge tone="warn">Sem reposição</ReposBadge>;
}

// ── Célula de produto (miniatura + nome + SKU/EAN + ícones) ────

const GAP_LABEL: Record<"custo" | "fornecedor" | "local", string> = {
  custo: "sem custo",
  fornecedor: "sem fornecedor",
  local: "sem localização",
};

function GapIcon({ icon: Icon, title, color, onClick }: { icon: React.ElementType; title: string; color: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      title={title}
      aria-label={title}
      className={cn("shrink-0 rounded transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)", color)}
    >
      <Icon size={13} />
    </button>
  );
}

function ProdutoCell({ s, onPendencias }: { s: SaldoRow; onPendencias?: () => void }) {
  const semLocal = !s.locationNome;
  const cadGaps = dataGaps(s).filter((g) => g !== "local"); // custo, fornecedor
  const mov = s.ultimaMovEm
    ? `${MOV_SHORT[s.ultimaMovTipo ?? ""] ?? "Movimentação"} ${relTime(s.ultimaMovEm)}`
    : "Sem movimentação";
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Thumb url={s.imagemUrl} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="truncate font-medium text-ink">{s.nome}</p>
          {s.tipo === "PERSONALIZADO" && (
            <span className="shrink-0 rounded-full bg-brand-soft px-1.5 py-px text-[10px] font-medium text-brand">
              <Zap size={9} className="-mt-px mr-0.5 inline" />Pers.
            </span>
          )}
          {s.locationNome && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-surface-2 px-1.5 py-px text-[10px] font-medium text-muted">
              <MapPin size={9} /> {s.locationNome}
            </span>
          )}
          {semLocal && (
            <GapIcon
              icon={MapPin}
              color="text-faint"
              title="Produto sem localização definida — clique para corrigir"
              onClick={onPendencias}
            />
          )}
          {cadGaps.length > 0 && (
            <GapIcon
              icon={AlertTriangle}
              color="text-warn"
              title={`Cadastro com pendências: ${cadGaps.map((g) => GAP_LABEL[g]).join(", ")} — clique para corrigir`}
              onClick={onPendencias}
            />
          )}
        </div>
        <p className={cn("mt-0.5 text-[11px]", s.ultimaMovEm ? "text-muted" : "text-faint")}>{mov}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
          <span className="font-mono text-faint">{s.sku}</span>
          {s.categoria && <span className="text-muted">{s.categoria}</span>}
        </div>
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
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: SortDir } | null;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort?.key === sortKey;
  return (
    <th className={cn("px-4 py-2.5", align === "right" && "text-right", className)}>
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
  const Icon = filtro === "sem" ? PackageCheck : filtro === "pendencias" ? ClipboardList : Boxes;
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-line bg-surface py-14 text-center">
      <Icon size={32} className="text-faint" />
      <p className="text-sm font-medium text-muted">
        {busca
          ? "Nenhum produto encontrado para a busca."
          : filtro === "sem"
            ? "Tudo abastecido — nenhum item zerado."
            : filtro === "pendencias"
              ? "Cadastro completo — nenhuma pendência."
              : filtro !== "todos"
                ? "Nenhum produto para este filtro."
                : "Nenhum produto com estoque neste site."}
      </p>
    </div>
  );
}

// ── Drawer de detalhe ─────────────────────────────────────────

function DetalheDrawer({
  saldo,
  initialTab,
  siteId,
  canRepor,
  onClose,
  onEditar,
  onRepor,
  onNovaMovimentacao,
  onAjustado,
}: {
  saldo: SaldoRow | null;
  initialTab: Tab;
  siteId: string | null;
  canRepor: boolean;
  onClose: () => void;
  onEditar: (productId: string) => void;
  onRepor: (s: SaldoRow) => void;
  onNovaMovimentacao: (s: SaldoRow) => void;
  onAjustado: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => { if (saldo) setTab(initialTab); }, [saldo, initialTab]);

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
              onNovaMovimentacao={onNovaMovimentacao}
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
  onNovaMovimentacao,
  onAjustado,
}: {
  s: SaldoRow;
  siteId: string | null;
  canRepor: boolean;
  gaps: ("custo" | "fornecedor" | "local")[];
  onEditar: (productId: string) => void;
  onRepor: (s: SaldoRow) => void;
  onNovaMovimentacao: (s: SaldoRow) => void;
  onAjustado: () => void;
}) {
  const st = statusOf(s);
  const status = STATUS_META[st];
  const base = s.custo ?? s.custoMedio;
  const un = s.unidadeBase.toLowerCase();
  const med = mediaDia(s);
  const media7 = s.consumo7 / 7;
  const media30 = s.consumo30 / 30;
  const deficit = s.estoqueIdeal > 0 && s.estoqueFechado < s.estoqueIdeal ? s.estoqueIdeal - s.estoqueFechado : 0;
  const dura = med > 0 && deficit > 0 ? Math.round(deficit / med) : null;
  const custoSug = base != null && deficit > 0 ? deficit * base : null;
  const pctAberta = temAbertaFrac(s) ? Math.round((s.estoqueAberto / s.conteudoPorUnidade!) * 100) : 0;
  const podeRepor = canRepor && precisaRepor(s);
  const [ajuste, setAjuste] = useState(false);

  const gapMsg: Record<"custo" | "fornecedor" | "local", string> = {
    local: "Localização não cadastrada",
    custo: "Custo não informado",
    fornecedor: "Fornecedor não vinculado",
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── Topo: tudo que importa em 5s ── */}
      <div className="rounded-xl border border-line bg-surface-2/50 p-4">
        <div className="flex items-start gap-3">
          <Thumb url={s.imagemUrl} size={56} />
          <div className="min-w-0 flex-1">
            <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-xs font-semibold", status.text)}>
              <status.Icon size={13} /> {status.label}
            </span>
            <p className="mt-1 truncate text-xs text-muted">
              {[s.marca, s.categoria, TIPO_LABEL[s.tipo] ?? s.tipo].filter(Boolean).join(" · ")}
            </p>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span>
                <span className="font-mono text-base font-bold tabular-nums text-ink">{fmt(s.estoqueFechado)}</span>
                <span className="text-xs text-muted"> fechadas</span>
              </span>
              {temAbertaFrac(s) && (
                <span>
                  <span className="font-mono text-base font-bold tabular-nums text-accent">{fmtVol(s.estoqueAberto, un)}</span>
                  <span className="text-xs text-muted"> aberta</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {deficit > 0 ? (
          <p className="mt-3 text-sm font-medium text-ink">
            Faltam <span className="font-semibold text-brand">{fmt(deficit)} un</span> para o ideal
          </p>
        ) : (
          <p className="mt-3 text-sm font-medium text-ok">Estoque no ideal</p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {podeRepor && (
            <button
              type="button"
              onClick={() => onRepor(s)}
              className="flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
            >
              <RefreshCw size={14} /> Repor
            </button>
          )}
          <button
            type="button"
            onClick={() => setAjuste((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
              ajuste ? "border-brand bg-brand-soft text-brand" : "border-line bg-surface text-ink hover:bg-surface-2",
            )}
          >
            <SlidersHorizontal size={14} className={ajuste ? "" : "text-muted"} /> Ajustar saldo
          </button>
        </div>
      </div>

      {/* Ajuste rápido — controlado pelo botão do topo */}
      <AjusteInline s={s} siteId={siteId} onAjustado={onAjustado} aberta={ajuste} setAberta={setAjuste} />

      {/* ── Cadastro incompleto (some quando resolvido) ── */}
      {gaps.length > 0 && (
        <div className="rounded-xl border border-warn/30 bg-warn-soft/50 p-3.5">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-warn">
            <AlertTriangle size={15} /> Cadastro incompleto
          </div>
          <ul className="mt-1.5 flex flex-col gap-0.5 text-xs text-ink-2">
            {gaps.map((g) => <li key={g}>{gapMsg[g]}</li>)}
          </ul>
          <button
            type="button"
            onClick={() => onEditar(s.productId)}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-warn/40 bg-surface px-3 py-1.5 text-xs font-semibold text-warn transition-colors hover:bg-warn-soft"
          >
            <Pencil size={13} /> Completar cadastro
          </button>
        </div>
      )}

      {/* ── SALDO ── */}
      <div className="rounded-xl border border-line bg-surface p-4">
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-faint">Saldo</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Fechadas" value={`${fmt(s.estoqueFechado)} un`} />
          <Field
            label="Aberta"
            value={temAbertaFrac(s) ? `${fmtVol(s.estoqueAberto, un)} (${pctAberta}%)` : "—"}
            tone={temAbertaFrac(s) ? "accent" : undefined}
          />
          <Field label="Ideal" value={s.estoqueIdeal > 0 ? `${fmt(s.estoqueIdeal)} un` : "—"} />
          <Field label="Comprar" value={deficit > 0 ? `${fmt(deficit)} un` : "no ideal"} tone={deficit > 0 ? "brand" : "ok"} />
        </dl>
        {deficit > 0 && (dura != null || custoSug != null) && (
          <p className="mt-3 border-t border-line pt-2.5 text-xs text-muted">
            Sugestão: comprar {fmt(deficit)} un
            {dura != null && ` · ≈ dura ${dura} ${dura === 1 ? "dia" : "dias"}`}
            {custoSug != null && ` · ${fmtMoney(custoSug)}`}
          </p>
        )}
      </div>

      {/* ── EM USO — unidade aberta, vendida em doses/drinks ── */}
      {temAbertaFrac(s) && (
        <div className="rounded-xl border border-line bg-surface p-4">
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-faint">Em uso</h3>
          <AbertaCell s={s} />
        </div>
      )}

      {/* ── Consumo médio (linha única, espaçada) ── */}
      <div className="rounded-xl border border-line bg-surface px-4 py-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-faint">Consumo médio</h3>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-8 gap-y-2 text-sm tabular-nums text-ink">
          <span><span className="text-muted">Hoje</span> <b>{fmt(s.consumoHoje)}</b></span>
          <span><span className="text-muted">7 dias</span> <b>{fmt1(media7)}</b><span className="text-faint">/dia</span></span>
          <span><span className="text-muted">30 dias</span> <b>{fmt1(media30)}</b><span className="text-faint">/dia</span></span>
        </div>
      </div>

      {/* ── COMERCIAL ── */}
      <div className="rounded-xl border border-line bg-surface p-4">
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-faint">Comercial</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Venda" value={s.precoVenda != null ? fmtMoney(s.precoVenda) : "—"} />
          <Field label="Custo" value={base != null ? fmtMoney(base) : "—"} />
          <Field label="Médio" value={s.custoMedio != null ? fmtMoney(s.custoMedio) : "—"} />
          <Field label="Fornecedor" value={s.fornecedorNome ?? "—"} />
          <Field label="Valor em estoque" value={s.custoMedio != null ? fmtMoney(valorEstoque(s)) : "—"} />
        </dl>
      </div>

      {/* ── Ações ── */}
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <button
          type="button"
          onClick={() => onEditar(s.productId)}
          className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
        >
          <Pencil size={14} className="text-muted" /> Configurações do estoque
        </button>
        <button
          type="button"
          onClick={() => onNovaMovimentacao(s)}
          className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
        >
          <RefreshCw size={14} className="text-muted" /> Nova movimentação
        </button>
      </div>
    </div>
  );
}

// Campo compacto rótulo-sobre-valor (dentro de cards agrupados).
function Field({ label, value, tone }: { label: string; value: string; tone?: "accent" | "brand" | "ok" }) {
  const toneCls =
    tone === "accent" ? "text-accent"
    : tone === "brand" ? "text-brand"
    : tone === "ok" ? "text-ok"
    : "text-ink";
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</dt>
      <dd className={cn("mt-0.5 truncate font-mono text-sm font-semibold tabular-nums", toneCls)}>{value}</dd>
    </div>
  );
}

// ── Ajuste rápido inline ──────────────────────────────────────

function AjusteInline({
  s,
  siteId,
  onAjustado,
  aberta,
  setAberta,
}: {
  s: SaldoRow;
  siteId: string | null;
  onAjustado: () => void;
  aberta: boolean;
  setAberta: (b: boolean) => void;
}) {
  const [contagem, setContagem] = useState<string>(String(s.estoqueFechado));
  const [motivo, setMotivo] = useState("");
  const [pending, setPending] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const nova = Number(contagem.replace(",", "."));
  const delta = Number.isFinite(nova) ? nova - s.estoqueFechado : 0;
  const podeEnviar = siteId != null && Number.isFinite(nova) && delta !== 0 && motivo.trim().length >= 3 && !pending;

  if (!aberta) return null;

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
    <div className="flex flex-col gap-3 rounded-xl border border-line-strong bg-surface-2 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">Ajustar saldo por contagem</p>
        <button
          type="button"
          onClick={() => setAberta(false)}
          aria-label="Cancelar ajuste"
          className="grid h-7 w-7 place-items-center rounded-lg text-muted transition-colors hover:bg-line-strong/40 hover:text-ink"
        >
          <X size={16} />
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

      <Link
        href="/estoque/movimentacoes"
        className="self-start text-sm font-medium text-brand transition-colors hover:underline"
      >
        Ver todas as movimentações
      </Link>
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
