"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
  useId,
  useRef,
  type ComponentProps,
} from "react";
import { createPortal } from "react-dom";
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
  ChevronDown,
  History,
  ArrowLeftRight,
  Zap,
  SlidersHorizontal,
  Loader2,
  PackageX,
  PackageOpen,
  PackageCheck,
  Package,
  MapPin,
  Box,
  Refrigerator,
  Snowflake,
  Info,
  Columns3,
  FilterX,
  Truck,
  X,
  ShoppingCart,
  Copy,
  Check,
  Lightbulb,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MSG_APRENDIZADO,
  POLICY_PADRAO,
  fmtCobertura,
  mediaDiaria,
  necessidadeGiro,
  nivelCobertura,
  type EstoquePolicy,
} from "@/lib/estoque-estrategia";
import { toast } from "@/components/ui/toast";
import { Sheet } from "@/components/ui/sheet";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Input, Select } from "@/components/ui/input";
import { NovaEntradaForm, type Item } from "../entradas/nova/_client";
import { AdicionarCompraSheet } from "./_comprar";
import { PEDIDO_STATUS } from "../../compras/_ui";
import type { SaldoRow, LocalArmazenagemRow } from "../_data";
import {
  fetchHistoricoProductAction,
  registrarAjusteAction,
  fetchEntradaFormDataAction,
  alterarLocalEmMassaAction,
} from "../actions";

const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const fmt1 = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const fmtMoney = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Data de previsão em linguagem operacional: "hoje", "amanhã", "em 12/07". */
function previsaoLabel(iso: string): string {
  const d = new Date(iso); d.setHours(0, 0, 0, 0);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const dias = Math.round((d.getTime() - t.getTime()) / 864e5);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "amanhã";
  return `em ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
}

const STORAGE_TIPO_ICON: Record<"AMBIENTE" | "REFRIGERADO" | "CONGELADO", React.ElementType> = {
  AMBIENTE: Box,
  REFRIGERADO: Refrigerator,
  CONGELADO: Snowflake,
};

const STORAGE_TIPO_COLOR: Record<"AMBIENTE" | "REFRIGERADO" | "CONGELADO", string> = {
  AMBIENTE: "text-brand",
  REFRIGERADO: "text-ok",
  CONGELADO: "text-blue-500",
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

/** Linha de contexto do movimento: pedido, nota, fornecedor, terminal, drink. */
function getMovSub(m: HistoricoItem): string | null {
  const partes: string[] = [];
  if (m.tipo === "ENTRADA") {
    if (m.purchasePedido) partes.push(`Pedido ${m.purchasePedido}`);
    else if (m.purchaseNota) partes.push(`Nota ${m.purchaseNota}`);
    if (m.purchaseSupplier) partes.push(m.purchaseSupplier);
  }
  if (m.tipo === "SAIDA" && m.saleTerminal) partes.push(m.saleTerminal);
  if (m.tipo === "PRODUCAO" && m.producaoDrinkNome) partes.push(`Drink: ${m.producaoDrinkNome}`);
  return partes.length > 0 ? partes.join(" · ") : null;
}

/** Data do movimento na linguagem do dia a dia: "Hoje • 14:22", "20/07 • 15:29". */
function fmtMovData(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dia = new Date(d); dia.setHours(0, 0, 0, 0);
  const diff = Math.round((hoje.getTime() - dia.getTime()) / 864e5);
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const rotulo =
    diff === 0 ? "Hoje"
    : diff === 1 ? "Ontem"
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return `${rotulo} • ${hora}`;
}

export type Filtro = "todos" | "sem" | "baixoMinimo" | "repor" | "quaseIdeal" | "baixaCobertura" | "aberto";
type SortKey = "nome" | "fechado" | "valor";
type SortDir = "asc" | "desc";
type FormOptions = Pick<ComponentProps<typeof NovaEntradaForm>, "products" | "sites">;
type HistoricoItem = Awaited<ReturnType<typeof fetchHistoricoProductAction>>[number];

// ── Situação do estoque ───────────────────────────────────────
// O que é "estar bem" depende da estratégia da empresa
// (lib/estoque-estrategia):
//  · MINIMO       → fechado × mínimo;
//  · MINIMO_IDEAL → fechado × mínimo × ideal (sem nenhum dos dois: "Meta não definida");
//  · ROTATIVIDADE → cobertura em dias × cobertura desejada.
// Em todos, o aberto entra só para distinguir zerado real.

type Status =
  | "semEstoque"
  | "semMeta"
  | "baixoMinimo"
  | "baixoIdeal"
  | "abastecido"
  | "semControle"
  | "coberturaCritica"
  | "coberturaAtencao"
  | "semGiro";

/** Contexto da estratégia — evita passar policy por dez níveis de componente. */
const PolicyCtx = createContext<EstoquePolicy>(POLICY_PADRAO);
const usePolicy = () => useContext(PolicyCtx);

/** Produto marcado para não controlar estoque — some do funil de meta/urgência, só informa qtd comprada. */
const semControle = (s: SaldoRow) => !s.controlaEstoque;

function statusOf(s: SaldoRow, policy: EstoquePolicy): Status {
  if (semControle(s)) return "semControle";
  const f = s.estoqueFechado;
  if (f <= 0 && s.estoqueAberto <= 0) return "semEstoque";

  if (policy.usaGiro) {
    const cob = diasCobertura(s, policy);
    if (cob == null) return "semGiro";
    const nivel = nivelCobertura(cob, policy.diasCobertura);
    if (nivel === "muito-baixo") return "coberturaCritica";
    if (nivel === "atencao") return "coberturaAtencao";
    return "abastecido";
  }

  const { estoqueMinimo: min, estoqueIdeal: ideal } = s;
  const idealAtivo = policy.usaIdeal ? ideal : 0;
  if (min <= 0 && idealAtivo <= 0) return "semMeta";
  if (min > 0 && f < min) return "baixoMinimo";
  if (idealAtivo > 0 && f < idealAtivo) return "baixoIdeal";
  return "abastecido";
}

// Rampa de severidade: danger (crítico) → warn (urgente) → brand (ação de repor,
// mesma cor do CTA "Repor") → ok. semMeta/semGiro/semControle são neutros — não são alerta.
const STATUS_META: Record<Status, { label: string; text: string; dot: string; bar: string; Icon: React.ElementType }> = {
  abastecido:  { label: "Abastecido",       text: "text-ok",     dot: "bg-ok",     bar: "bg-ok",     Icon: PackageCheck },
  baixoIdeal:  { label: "Abaixo do ideal",  text: "text-brand",  dot: "bg-brand",  bar: "bg-brand",  Icon: AlertTriangle },
  baixoMinimo: { label: "Abaixo do mínimo", text: "text-danger", dot: "bg-danger", bar: "bg-danger", Icon: AlertTriangle },
  semEstoque:  { label: "Sem estoque",      text: "text-danger", dot: "bg-danger", bar: "bg-danger", Icon: PackageX },
  semMeta:     { label: "Meta não definida",text: "text-faint",  dot: "bg-faint",  bar: "bg-faint",  Icon: PackageX },
  semControle: { label: "Sem controle",     text: "text-faint",  dot: "bg-faint",  bar: "bg-faint",  Icon: Package },
  coberturaCritica: { label: "Cobertura crítica", text: "text-danger", dot: "bg-danger", bar: "bg-danger", Icon: AlertTriangle },
  coberturaAtencao: { label: "Cobertura em atenção", text: "text-brand", dot: "bg-brand", bar: "bg-brand", Icon: AlertTriangle },
  semGiro:     { label: "Sem giro",         text: "text-faint",  dot: "bg-faint",  bar: "bg-faint",  Icon: PackageX },
};

const semEstoque = (s: SaldoRow, policy: EstoquePolicy) => statusOf(s, policy) === "semEstoque";
const abaixoMin = (s: SaldoRow) => !semControle(s) && s.estoqueMinimo > 0 && s.estoqueFechado < s.estoqueMinimo;
const precisaRepor = (s: SaldoRow) => !semControle(s) && s.estoqueIdeal > 0 && s.estoqueFechado < s.estoqueIdeal;
const valorEstoque = (s: SaldoRow) => s.estoqueFechado * (s.custoMedio ?? 0);
const disponivel = (s: SaldoRow) => s.estoqueFechado - s.estoqueAberto;
const temEstoqueAberto = (s: SaldoRow) => s.estoqueAberto > 0;

/**
 * Média diária de vendas. Na rotatividade é a janela que a empresa configurou;
 * nas demais estratégias segue o atalho de sempre (7d, caindo p/ 30d).
 */
const mediaDia = (s: SaldoRow, policy: EstoquePolicy) =>
  policy.usaGiro
    ? mediaDiaria(s.consumoJanela, s.janelaDias)
    : s.consumo7 > 0
      ? s.consumo7 / 7
      : s.consumo30 > 0
        ? s.consumo30 / 30
        : 0;

/** Dias de cobertura = saldo fechado ÷ média diária. null = sem giro. */
function diasCobertura(s: SaldoRow, policy: EstoquePolicy): number | null {
  const m = mediaDia(s, policy);
  if (m <= 0) return null;
  return Math.max(0, Math.round(s.estoqueFechado / m));
}

/** Linha em vermelho: abaixo do mínimo ou cobertura crítica, conforme a estratégia. */
function critico(s: SaldoRow, policy: EstoquePolicy): boolean {
  const st = statusOf(s, policy);
  return st === "baixoMinimo" || st === "coberturaCritica";
}

/** Cobertura abaixo da desejada — o "precisa repor" do modo rotatividade. */
function baixaCobertura(s: SaldoRow, policy: EstoquePolicy): boolean {
  if (semControle(s) || !policy.usaGiro) return false;
  const cob = diasCobertura(s, policy);
  const nivel = nivelCobertura(cob, policy.diasCobertura);
  return nivel === "muito-baixo" || nivel === "atencao";
}

/**
 * Alerta preventivo: ainda no ideal, mas o ritmo de venda vai derrubar o
 * saldo abaixo do ideal em menos de 1 dia — antecipa a reposição em vez de
 * esperar o produto já entrar em "Abaixo do ideal".
 */
function quaseIdeal(s: SaldoRow, policy: EstoquePolicy): boolean {
  if (semControle(s) || !policy.usaIdeal) return false;
  if (s.estoqueIdeal <= 0 || s.estoqueFechado < s.estoqueIdeal) return false;
  const m = mediaDia(s, policy);
  return m > 0 && s.estoqueFechado - s.estoqueIdeal < m;
}

/** Lacunas de cadastro que atrapalham operação (custo, fornecedor, localização). */
function dataGaps(s: SaldoRow): ("custo" | "fornecedor" | "local")[] {
  const g: ("custo" | "fornecedor" | "local")[] = [];
  if (s.custoMedio == null) g.push("custo");
  if (!s.temFornecedor) g.push("fornecedor");
  if (!s.locationNome) g.push("local");
  return g;
}

// semControle fica por último — é informativo, nunca uma pendência a resolver.
const PRIORITY: Record<Status, number> = {
  semEstoque: 0,
  baixoMinimo: 1,
  coberturaCritica: 1,
  baixoIdeal: 2,
  coberturaAtencao: 2,
  semMeta: 3,
  semGiro: 3,
  abastecido: 4,
  semControle: 5,
};

/* CSV: separador ";" e decimal com vírgula (Excel pt-BR). As colunas de meta
   seguem a estratégia — quem controla por giro exporta média e cobertura. */
function toCsv(rows: SaldoRow[], policy: EstoquePolicy): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3, useGrouping: false });
  const head = [
    "Produto", "Tipo", "SKU", "Codigo de barras", "Categoria", "Marca", "Fornecedor",
    "Fechado", "Aberto", "Disponivel",
    ...(policy.usaMinimo ? ["Minimo"] : []),
    ...(policy.usaIdeal ? ["Ideal"] : []),
    ...(policy.usaGiro ? ["Media diaria", "Cobertura (dias)", "Cobertura desejada"] : []),
    "Custo medio", "Valor em estoque", "Local",
  ];
  const body = rows.map((s) => {
    const cob = diasCobertura(s, policy);
    return [
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
      ...(policy.usaMinimo ? [num(s.estoqueMinimo)] : []),
      ...(policy.usaIdeal ? [num(s.estoqueIdeal)] : []),
      ...(policy.usaGiro
        ? [num(mediaDia(s, policy)), cob != null ? num(cob) : "", num(policy.diasCobertura)]
        : []),
      num(s.custoMedio ?? 0),
      num(valorEstoque(s)),
      esc(s.locationNome ?? ""),
    ].join(";");
  });
  return [head.join(";"), ...body].join("\r\n");
}

function baixarCsv(rows: SaldoRow[], policy: EstoquePolicy) {
  const csv = "﻿" + toCsv(rows, policy);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `saldos-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Colunas configuráveis (persistidas no navegador, não na URL) ─────────────
type ColKey = "local" | "fornecedor" | "aberto" | "pedido";
const COL_ORDER: ColKey[] = ["local", "aberto", "fornecedor", "pedido"];
const COL_LABEL: Record<ColKey, string> = {
  local: "Local", fornecedor: "Fornecedor", aberto: "Aberto (consumo/drinks)", pedido: "Pedido",
};
const DEFAULT_COLS: Record<ColKey, boolean> = { local: true, fornecedor: true, aberto: true, pedido: true };

function readLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

// ── Componente principal ──────────────────────────────────────

type Tab = "resumo" | "historico";

export function SaldosView({
  saldos,
  policy = POLICY_PADRAO,
  siteId,
  locais = [],
  initialQ = "",
  initialFiltro = "todos",
  initialPage = 1,
}: {
  saldos: SaldoRow[];
  /** Estratégia de controle da empresa — define metas, filtros e colunas. */
  policy?: EstoquePolicy;
  siteId: string | null;
  /** Locais de armazenagem ativos da loja — destinos da alteração em massa. */
  locais?: LocalArmazenagemRow[];
  initialQ?: string;
  initialFiltro?: Filtro;
  initialPage?: number;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQ);
  const [filtro, setFiltro] = useState<Filtro>(initialFiltro);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);
  const [entradaItems, setEntradaItems] = useState<Item[] | null>(null);
  const [entradaLoading, setEntradaLoading] = useState(false);
  // Compra manual — o operador escolhe produtos e o sistema só registra.
  const [comprarIds, setComprarIds] = useState<string[] | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [detalhe, setDetalhe] = useState<{ row: SaldoRow; tab: Tab } | null>(null);
  const [page, setPage] = useState(initialPage);
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

  // Colunas exibidas na tabela — preferência de exibição (como em /produtos).
  const [cols, setCols] = useState<Record<ColKey, boolean>>(() => readLS("estoque:cols", DEFAULT_COLS));
  useEffect(() => { try { localStorage.setItem("estoque:cols", JSON.stringify(cols)); } catch {} }, [cols]);

  const counts = useMemo(() => {
    let sem = 0, baixoMinimo = 0, repor = 0, quaseIdealN = 0, cobertura = 0, aberto = 0, semlocal = 0, pendencias = 0, comEstoque = 0, semMeta = 0;
    for (const s of saldos) {
      if (!semEstoque(s, policy)) comEstoque++; else sem++;
      if (abaixoMin(s)) baixoMinimo++;
      if (precisaRepor(s)) repor++;
      if (quaseIdeal(s, policy)) quaseIdealN++;
      if (baixaCobertura(s, policy)) cobertura++;
      if (temEstoqueAberto(s)) aberto++;
      if (!s.locationNome) semlocal++;
      if (dataGaps(s).length > 0) pendencias++;
      if (statusOf(s, policy) === "semMeta") semMeta++;
    }
    return { todos: saldos.length, sem, baixoMinimo, repor, quaseIdeal: quaseIdealN, baixaCobertura: cobertura, aberto, semlocal, pendencias, comEstoque, semMeta };
  }, [saldos, policy]);

  // Filtros secundários (painel "Filtros") — categoria/fornecedor/local derivados dos dados.
  const [avComEstoque, setAvComEstoque] = useState(false);
  const [avSemLocal, setAvSemLocal] = useState(false);
  const [avSemMeta, setAvSemMeta] = useState(false);
  const [avPendenciaCadastro, setAvPendenciaCadastro] = useState(false);
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
  // Nomes de local presentes nos dados — opções do filtro (≠ `locais`, que são
  // os locais cadastrados da loja e servem de destino na alteração em massa).
  const locaisFiltro = useMemo(
    () => [...new Set(saldos.map((s) => s.locationNome).filter((v): v is string => !!v))].sort(),
    [saldos],
  );

  const avancadoAtivo = avComEstoque || avSemLocal || avSemMeta || avPendenciaCadastro || !!avCategoria || !!avFornecedor || !!avLocal;
  const advCount = [avComEstoque, avSemLocal, avSemMeta, avPendenciaCadastro, !!avCategoria, !!avFornecedor, !!avLocal].filter(Boolean).length;
  function limparAvancado() {
    setAvComEstoque(false);
    setAvSemLocal(false);
    setAvSemMeta(false);
    setAvPendenciaCadastro(false);
    setAvCategoria("");
    setAvFornecedor("");
    setAvLocal("");
  }

  const filtrados = useMemo(() => {
    const termo = q.trim().toLowerCase();
    const out = saldos.filter((s) => {
      switch (filtro) {
        case "sem":            if (!semEstoque(s, policy)) return false; break;
        case "baixoMinimo":    if (!abaixoMin(s)) return false; break;
        case "repor":          if (!precisaRepor(s)) return false; break;
        case "quaseIdeal":     if (!quaseIdeal(s, policy)) return false; break;
        case "baixaCobertura": if (!baixaCobertura(s, policy)) return false; break;
        case "aberto":         if (!temEstoqueAberto(s)) return false; break;
      }
      if (avComEstoque && semEstoque(s, policy)) return false;
      if (avSemLocal && s.locationNome) return false;
      if (avSemMeta && statusOf(s, policy) !== "semMeta") return false;
      if (avPendenciaCadastro && dataGaps(s).length === 0) return false;
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
      // Sort explícito do usuário vence o agrupamento por severidade —
      // clicar "Produto A→Z" deve ordenar a lista inteira, não dentro dos grupos.
      if (sort) {
        const f = (s: SaldoRow) =>
          sort.key === "nome" ? s.nome.toLowerCase()
          : sort.key === "fechado" ? s.estoqueFechado
          : valorEstoque(s);
        const va = f(a), vb = f(b);
        const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
        if (cmp !== 0) return sort.dir === "asc" ? cmp : -cmp;
        return a.nome.localeCompare(b.nome);
      }
      const pa = PRIORITY[statusOf(a, policy)], pb = PRIORITY[statusOf(b, policy)];
      if (pa !== pb) return pa - pb;
      return a.nome.localeCompare(b.nome);
    });

    return out;
  }, [saldos, policy, q, filtro, sort, avComEstoque, avSemLocal, avSemMeta, avPendenciaCadastro, avCategoria, avFornecedor, avLocal]);

  // Paginação — volta à 1ª página quando o conjunto muda. Pula o mount para
  // não descartar a página restaurada da URL.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setPage(1);
  }, [q, filtro, sort, pageSize, avComEstoque, avSemLocal, avSemMeta, avPendenciaCadastro, avCategoria, avFornecedor, avLocal]);
  const total = filtrados.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const inicio = (pageSafe - 1) * pageSize;
  const pageRows = filtrados.slice(inicio, inicio + pageSize);

  // Espelha busca/filtro/página na URL (compartilhável, sobrevive a refresh e
  // troca de site) sem round-trip ao servidor — replaceState não navega.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const set = (k: string, v: string) => { if (v) p.set(k, v); else p.delete(k); };
    set("q", q.trim());
    set("filtro", filtro === "todos" ? "" : filtro);
    set("pagina", pageSafe > 1 ? String(pageSafe) : "");
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [q, filtro, pageSafe]);

  function toggleSort(key: SortKey) {
    setSort((cur) =>
      cur?.key === key
        ? cur.dir === "asc" ? { key, dir: "desc" } : null
        : { key, dir: "asc" },
    );
  }

  /** Nova movimentação a partir do sidepanel de detalhe — prefila este produto. */
  async function abrirNovaMovimentacao(s: SaldoRow) {
    setEntradaLoading(true);
    try {
      const opts = await ensureFormOptions();
      const prod = opts.products.find((p) => p.id === s.productId);
      const padrao = prod?.packagings.find((pk) => pk.isCompraDefault);
      setEntradaItems([
        prod
          ? { productId: prod.id, quantidade: 1, custoTotal: 0, custoDisplay: "", packagingId: padrao?.id ?? null, validade: null, lote: null }
          : { productId: "", quantidade: 1, custoTotal: 0, custoDisplay: "", packagingId: null, validade: null, lote: null },
      ]);
    } finally {
      setEntradaLoading(false);
    }
  }

  // ── Local de armazenagem em massa ─────────────────────────────
  // Local é atributo do saldo na loja, não movimentação: aplica direto nos
  // produtos selecionados e limpa a seleção (o refresh traz o novo local).
  const [localSalvando, setLocalSalvando] = useState(false);
  async function aplicarLocal(local: LocalArmazenagemRow | null) {
    if (!siteId || selecionados.size === 0 || localSalvando) return;
    const ids = [...selecionados];
    setLocalSalvando(true);
    try {
      const { count } = await alterarLocalEmMassaAction({
        siteId,
        productIds: ids,
        locationId: local?.id ?? null,
      });
      toast.success(
        local ? `Movidos para ${local.nome}` : "Local removido",
        `${count} ${count === 1 ? "produto atualizado" : "produtos atualizados"}.`,
      );
      setSelecionados(new Set());
      router.refresh();
    } catch (e) {
      toast.error(
        "Não foi possível alterar o local",
        e instanceof Error ? e.message : "Tente novamente.",
      );
    } finally {
      setLocalSalvando(false);
    }
  }

  // ── Seleção múltipla (checkbox por linha + action bar) ────────
  function toggleSelecionado(productId: string) {
    setSelecionados((cur) => {
      const next = new Set(cur);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  type Pill = { key: Filtro; label: string; count: number; tone: "neutral" | "danger" | "warn" | "brand" };
  // Pills = mesmo estado de filtro dos KPIs acima (clicar um seleciona o
  // outro também) — só um segundo jeito de chegar no mesmo filtro, mais os
  // dois que não têm KPI: alerta preventivo e estoque aberto.
  const pillsEstoque: Pill[] = policy.usaGiro
    ? [
        { key: "todos",          label: "Todos",           count: counts.todos,          tone: "neutral" },
        { key: "sem",            label: "Sem estoque",     count: counts.sem,            tone: "danger"  },
        { key: "baixaCobertura", label: "Cobertura baixa", count: counts.baixaCobertura, tone: "brand"   },
        { key: "aberto",         label: "Estoque aberto",  count: counts.aberto,         tone: "neutral" },
      ]
    : [
        { key: "todos",       label: "Todos",             count: counts.todos,      tone: "neutral" },
        { key: "baixoMinimo", label: "Abaixo do mínimo",  count: counts.baixoMinimo, tone: "danger" },
        ...(policy.usaIdeal
          ? ([
              { key: "repor",      label: "Abaixo do ideal", count: counts.repor,      tone: "brand" },
              { key: "quaseIdeal", label: "Quase do ideal",  count: counts.quaseIdeal, tone: "warn"  },
            ] as Pill[])
          : []),
        { key: "aberto",      label: "Estoque aberto",    count: counts.aberto,     tone: "neutral" },
      ];

  const pageAllSelected = pageRows.length > 0 && pageRows.every((s) => selecionados.has(s.productId));
  function togglePageSelecionada() {
    setSelecionados((cur) => {
      const next = new Set(cur);
      if (pageAllSelected) pageRows.forEach((s) => next.delete(s.productId));
      else pageRows.forEach((s) => next.add(s.productId));
      return next;
    });
  }

  return (
   <PolicyCtx.Provider value={policy}>
    <div className="flex flex-col gap-4">
      {/* ── Filtros + tabela na mesma superfície (mesmo padrão visual de /produtos) ── */}
      <div className="w-full rounded-[var(--radius-lg)] bg-surface p-3 shadow-[var(--shadow-float)] sm:p-4">
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-line bg-surface-2 p-2">
        <div className="relative min-w-48 flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }}
            placeholder="Buscar por nome, SKU, código, categoria, marca ou fornecedor…"
            className="h-9 rounded-full border-line bg-surface pl-9 pr-8"
          />
          {q !== "" && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Limpar busca"
              className="absolute right-2.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-faint transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <Select value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
          {pillsEstoque.map((p) => (
            <option key={p.key} value={p.key}>{p.label}{p.count > 0 ? ` (${p.count})` : ""}</option>
          ))}
        </Select>

        {categorias.length > 0 && (
          <Select value={avCategoria} onChange={(e) => setAvCategoria(e.target.value)} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
            <option value="">Toda categoria</option>
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        )}
        {cols.fornecedor && fornecedores.length > 0 && (
          <Select value={avFornecedor} onChange={(e) => setAvFornecedor(e.target.value)} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
            <option value="">Todo fornecedor</option>
            {fornecedores.map((f) => <option key={f} value={f}>{f}</option>)}
          </Select>
        )}
        {cols.local && locaisFiltro.length > 0 && (
          <Select value={avLocal} onChange={(e) => setAvLocal(e.target.value)} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
            <option value="">Todo local</option>
            {locaisFiltro.map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
        )}

        {/* Mais filtros (booleanos de higiene/negócio) */}
        <Menu
          align="end"
          className="w-72"
          trigger={
            <button
              type="button"
              className={cn(
                "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                avancadoAtivo
                  ? "border-brand/40 bg-brand-soft text-brand-strong"
                  : "border-line bg-surface text-ink-2 hover:bg-surface-2",
              )}
            >
              <SlidersHorizontal size={14} /> Mais filtros
              {advCount > 0 && (
                <span className="grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold text-on-brand">
                  {advCount}
                </span>
              )}
            </button>
          }
        >
          <div className="px-1 py-0.5">
            <CheckRow checked={avComEstoque} label="Com estoque" onChange={() => setAvComEstoque((v) => !v)} />
            <CheckRow checked={avSemLocal} label="Sem localização" onChange={() => setAvSemLocal((v) => !v)} />
            {/* "Sem meta" só existe onde há meta a definir. */}
            {!policy.usaGiro && (
              <CheckRow checked={avSemMeta} label="Sem meta definida" onChange={() => setAvSemMeta((v) => !v)} />
            )}
            <CheckRow checked={avPendenciaCadastro} label="Com pendência cadastral" onChange={() => setAvPendenciaCadastro((v) => !v)} />
          </div>
        </Menu>

        {/* Colunas exibidas na tabela */}
        <Menu
          align="end"
          trigger={
            <button
              type="button"
              aria-label="Colunas exibidas"
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-2"
            >
              <Columns3 size={14} /> Exibição
            </button>
          }
        >
          <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-faint">Colunas</p>
          {COL_ORDER.map((k) => (
            <CheckRow
              key={k}
              checked={cols[k]}
              label={COL_LABEL[k]}
              onChange={() => {
                setCols((c) => ({ ...c, [k]: !c[k] }));
                // Desliga o filtro junto — não faz sentido filtrar por uma coluna escondida.
                if (k === "local" && cols.local) setAvLocal("");
                if (k === "fornecedor" && cols.fornecedor) setAvFornecedor("");
              }}
            />
          ))}
        </Menu>

        {(filtro !== "todos" || q.trim() !== "" || avancadoAtivo) && (
          <button
            type="button"
            onClick={() => { setFiltro("todos"); setQ(""); limparAvancado(); }}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <FilterX size={14} /> Limpar
          </button>
        )}

        <button
          type="button"
          onClick={() => baixarCsv(filtrados, policy)}
          disabled={filtrados.length === 0}
          title="Exportar CSV"
          aria-label="Exportar CSV"
          className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
        >
          <Download size={15} />
        </button>
      </div>

      {filtrados.length === 0 ? (
        <div className="mt-4">
          <EmptyState filtro={filtro} busca={q} />
        </div>
      ) : (
        <>
          {/* ── Tabela (desktop) ── */}
          <div className="mt-4 hidden overflow-clip rounded-xl border border-line bg-surface md:block">
            <table className="w-full text-sm">
              {/* sticky exige overflow-clip no wrapper (overflow-hidden viraria o
                  ancestral de rolagem e anularia o efeito) */}
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-line bg-surface-2 text-left text-xs font-semibold uppercase tracking-wide text-faint">
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={pageAllSelected}
                      onChange={togglePageSelecionada}
                      aria-label="Selecionar todos os produtos da página"
                      className="h-4 w-4 accent-brand"
                    />
                  </th>
                  <Th label="Produto" sortKey="nome" sort={sort} onSort={toggleSort} />
                  {cols.local && <th className="px-4 py-2">Local</th>}
                  <Th label="Estoque" sortKey="fechado" sort={sort} onSort={toggleSort} />
                  {cols.aberto && (
                    <th className="hidden px-4 py-2 lg:table-cell">
                      <span className="inline-flex items-center gap-1" title="Conteúdo restante da unidade aberta, vendida em doses/drinks">
                        Aberto (consumo/drinks)
                        <Info size={12} className="text-faint" aria-label="Conteúdo restante da unidade aberta, vendida em doses/drinks" />
                      </span>
                    </th>
                  )}
                  {cols.fornecedor && <th className="hidden px-4 py-2 md:table-cell">Fornecedor</th>}
                  {cols.pedido && <th className="hidden px-4 py-2 md:table-cell">Pedido</th>}
                  <th className="w-px px-3 py-2" aria-hidden />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pageRows.map((s) => (
                  <tr
                    key={s.productId}
                    onClick={() => abrir(s)}
                    className={cn(
                      "group cursor-pointer transition-colors hover:bg-surface-2",
                      critico(s, policy) && "bg-danger-soft/40",
                      selecionados.has(s.productId) && "bg-brand-soft/30",
                    )}
                  >
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selecionados.has(s.productId)}
                        onChange={() => toggleSelecionado(s.productId)}
                        aria-label={`Selecionar ${s.nome}`}
                        className="h-4 w-4 accent-brand"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <ProdutoCell
                        s={s}
                        onOpen={() => abrir(s)}
                        onPendencias={() => router.push(`/produtos/${s.productId}/editar`)}
                      />
                    </td>
                    {cols.local && (
                      <td className="px-4 py-2">
                        <LocalCell s={s} />
                      </td>
                    )}
                    <td className="px-4 py-2">
                      <EstoqueCell s={s} />
                    </td>
                    {cols.aberto && (
                      <td className="hidden px-4 py-2 lg:table-cell">
                        <AbertaCell s={s} />
                      </td>
                    )}
                    {cols.fornecedor && (
                      <td className="hidden px-4 py-2 md:table-cell">
                        <FornecedorCell s={s} />
                      </td>
                    )}
                    {cols.pedido && (
                      <td className="hidden px-4 py-2 md:table-cell">
                        <ReposicaoStatusCell s={s} />
                      </td>
                    )}
                    <td className="px-3 py-2 text-right">
                      <ChevronRight size={16} className="ml-auto shrink-0 text-faint transition-colors group-hover:text-ink" />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-surface-2 text-xs font-semibold text-muted">
                  <td className="px-4 py-2" colSpan={3 + (cols.local ? 1 : 0)}>
                    {total} {total === 1 ? "produto" : "produtos"}
                  </td>
                  {cols.aberto && <td className="hidden px-4 py-2 lg:table-cell" />}
                  {cols.fornecedor && <td className="hidden px-4 py-2 md:table-cell" />}
                  {cols.pedido && <td className="hidden px-4 py-2 md:table-cell" />}
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* ── Cards (mobile) ── */}
          <div className="mt-4 flex flex-col gap-2.5 md:hidden">
            {pageRows.map((s) => (
              <div
                key={s.productId}
                role="button"
                tabIndex={0}
                onClick={() => abrir(s)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(s); } }}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
                  critico(s, policy) ? "border-danger/30 bg-danger-soft/30" : "border-line bg-surface",
                  selecionados.has(s.productId) && "border-brand/50 bg-brand-soft/20",
                )}
              >
                <input
                  type="checkbox"
                  checked={selecionados.has(s.productId)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSelecionado(s.productId)}
                  aria-label={`Selecionar ${s.nome}`}
                  className="mt-1 h-4 w-4 shrink-0 accent-brand"
                />
                <div className="min-w-0 flex-1">
                  <ProdutoCell s={s} onPendencias={() => router.push(`/produtos/${s.productId}/editar`)} />
                  <div className="mt-2 flex items-end justify-between gap-3">
                    <EstoqueCell s={s} />
                    {cols.pedido && (
                      <div className="shrink-0 text-right">
                        <ReposicaoStatusCell s={s} />
                      </div>
                    )}
                  </div>
                  {cols.aberto && temAbertaFrac(s) && (
                    <div className="mt-1.5">
                      <AbertaCell s={s} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3">
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
          </div>
        </>
      )}
      </div>

      {/* ── Drawer de detalhe ── */}
      <DetalheDrawer
        key={detalhe?.row.productId}
        saldo={detalhe?.row ?? null}
        initialTab={detalhe?.tab ?? "resumo"}
        siteId={siteId}
        canRepor={detalhe ? ["SIMPLES", "INSUMO"].includes(detalhe.row.tipo) : false}
        onClose={() => setDetalhe(null)}
        onEditar={(id) => router.push(`/produtos/${id}/editar`)}
        onComprar={(s) => { setDetalhe(null); setComprarIds([s.productId]); }}
        onNovaMovimentacao={(s) => { setDetalhe(null); abrirNovaMovimentacao(s); }}
        onAjustado={() => { setDetalhe(null); router.refresh(); }}
      />

      {/* ── Action bar — aparece com produtos selecionados ── */}
      {selecionados.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-surface py-2 pl-4 pr-2 shadow-(--shadow-2)">
            <span className="text-sm font-medium text-ink">
              <b className="tabular-nums">{selecionados.size}</b>{" "}
              {selecionados.size === 1 ? "produto selecionado" : "produtos selecionados"}
            </span>
            {siteId && locais.length > 0 && (
              <Menu
                align="start"
                className="max-h-80 w-64 overflow-y-auto"
                trigger={
                  <button
                    type="button"
                    disabled={localSalvando}
                    className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
                  >
                    {localSalvando ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />}
                    Alterar local
                    <ChevronDown size={13} className="text-faint" />
                  </button>
                }
              >
                <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-faint">
                  Mover para
                </p>
                {locais.map((l) => {
                  const Icon = STORAGE_TIPO_ICON[l.tipo];
                  return (
                    <MenuItem
                      key={l.id}
                      icon={<Icon size={14} className={STORAGE_TIPO_COLOR[l.tipo]} />}
                      onClick={() => aplicarLocal(l)}
                    >
                      {l.nome}
                    </MenuItem>
                  );
                })}
                <div className="my-1 h-px bg-line" />
                <MenuItem icon={<X size={14} />} onClick={() => aplicarLocal(null)}>
                  Sem local
                </MenuItem>
              </Menu>
            )}
            <button
              type="button"
              onClick={() => setComprarIds([...selecionados])}
              className="flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
            >
              <ShoppingCart size={14} /> Comprar
            </button>
            <button
              type="button"
              onClick={() => setSelecionados(new Set())}
              aria-label="Limpar seleção"
              className="grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ── Sidepanel — compra manual (sem sugestões) ── */}
      <AdicionarCompraSheet
        open={comprarIds !== null}
        produtoIds={comprarIds ?? []}
        siteId={siteId}
        onClose={() => setComprarIds(null)}
        onDone={() => {
          setComprarIds(null);
          setSelecionados(new Set());
          router.refresh();
        }}
      />

      {/* ── Sidepanel — nova movimentação (entrada manual) ── */}
      <Sheet
        open={entradaItems !== null || entradaLoading}
        onClose={() => setEntradaItems(null)}
        title="Nova movimentação"
        description="Adicione produtos diretamente ao estoque."
        width="xl"
      >
        {entradaItems && formOptions ? (
          <NovaEntradaForm
            {...formOptions}
            motivo="COMPRA_SEM_PEDIDO"
            embedded
            initialItems={entradaItems}
            onDone={() => setEntradaItems(null)}
          />
        ) : (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={20} className="animate-spin text-faint" />
          </div>
        )}
      </Sheet>
    </div>
   </PolicyCtx.Provider>
  );
}

// ── Checkbox de menu (Mais filtros / Exibição) ─────────────────

function CheckRow({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-sm text-ink transition-colors hover:bg-surface-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 cursor-pointer rounded border-line accent-brand"
      />
      {label}
    </label>
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

function LocalCell({ s }: { s: SaldoRow }) {
  if (!s.locationNome) return <span className="text-[11px] text-faint">—</span>;
  const Icon = s.locationTipo ? STORAGE_TIPO_ICON[s.locationTipo] : MapPin;
  const color = s.locationTipo ? STORAGE_TIPO_COLOR[s.locationTipo] : "text-faint";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-ink">
      <Icon size={13} className={cn("shrink-0", color)} /> {s.locationNome}
    </span>
  );
}

// ── Célula de fornecedor (principal + tooltip com todos) ─────

function FornecedorCell({ s }: { s: SaldoRow }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);

  const fornecedores = s.fornecedores ?? [];
  if (fornecedores.length === 0) return <span className="text-[11px] text-faint">—</span>;

  const principal = fornecedores.find((f) => f.principal) ?? fornecedores[0];
  const outros = fornecedores.length - 1;
  const hasMore = outros > 0;

  function handleEnter() {
    if (!hasMore) return;
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.top + window.scrollY, left: rect.left + window.scrollX });
    setShow(true);
  }

  return (
    <>
      <div
        ref={ref}
        className={cn("inline-flex items-center gap-1.5", hasMore && "cursor-help")}
        onMouseEnter={handleEnter}
        onMouseLeave={() => setShow(false)}
      >
        <Truck size={12} className="shrink-0 text-faint" />
        <span className="text-[12px] text-ink-2">{principal.nome}</span>
        {hasMore && (
          <span className="rounded-full bg-surface-2 px-1.5 py-px text-[10px] font-medium text-faint">+{outros}</span>
        )}
      </div>

      {show && hasMore && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-[100] min-w-50 max-w-70 rounded-lg border border-line bg-surface p-2.5 shadow-lg"
          style={{ top: pos.top - 8, left: pos.left, transform: "translateY(-100%)" }}
          onMouseEnter={() => setShow(true)}
          onMouseLeave={() => setShow(false)}
        >
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">Fornecedores</p>
          <ul className="space-y-1">
            {fornecedores.map((f, i) => (
              <li key={i} className="flex items-center gap-1.5 text-[12px] text-ink-2">
                <span className="truncate">{f.nome}</span>
                {f.principal && (
                  <span className="shrink-0 rounded-full bg-brand-soft px-1.5 py-px text-[9px] font-medium text-brand">Principal</span>
                )}
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}

function EstoqueCell({ s }: { s: SaldoRow }) {
  const policy = usePolicy();
  // Sem controle: só a quantidade comprada — nem barra, nem mínimo/ideal, nem cobertura.
  if (!s.controlaEstoque) {
    return (
      <div className="flex w-40 max-w-full flex-col gap-1">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-sm font-semibold tabular-nums text-ink">{fmt(s.estoqueFechado)}</span>
          <span className="text-[11px] text-muted">{closedUnitLabel(s)}</span>
        </div>
        <span className="text-[10px] text-faint">comprado · sem controle</span>
      </div>
    );
  }
  const st = statusOf(s, policy);
  const m = STATUS_META[st];
  const { estoqueFechado: f, estoqueIdeal: ideal, estoqueMinimo: min } = s;
  const cob = diasCobertura(s, policy);

  // A barra mede o progresso rumo à meta da estratégia: ideal, mínimo ou
  // cobertura desejada em dias.
  const alvoBarra = policy.usaGiro ? policy.diasCobertura : policy.usaIdeal ? ideal : min;
  const atualBarra = policy.usaGiro ? (cob ?? 0) : f;
  const pct = alvoBarra > 0 ? Math.round((atualBarra / alvoBarra) * 100) : f > 0 ? 100 : 0;
  const fill = Math.min(100, Math.max(0, pct));
  const minPos = !policy.usaGiro && policy.usaIdeal && ideal > 0 && min > 0
    ? Math.min(100, (min / ideal) * 100)
    : null;

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
      {/* Barra: progresso rumo à meta, com marcador do mínimo quando existe */}
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
      {policy.usaGiro ? (
        <div className="flex justify-between text-[10px] tabular-nums text-faint">
          <span>{fmt1(mediaDia(s, policy))}/dia</span>
          <span>meta {policy.diasCobertura} d</span>
        </div>
      ) : policy.usaIdeal && ideal > 0 ? (
        <div className="flex justify-between text-[10px] tabular-nums text-faint">
          <span>mín {fmt(min)}</span>
          <span>ideal {fmt(ideal)}</span>
        </div>
      ) : min > 0 ? (
        <span className="text-[10px] tabular-nums text-faint">mín {fmt(min)}</span>
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

// ── Célula de próxima compra (pedido de compra em aberto) ─────

/**
 * Coluna factual: mostra apenas pedidos de compra em aberto (o que já foi
 * decidido pelo operador), com o status real do pedido (enviado, confirmado,
 * em trânsito, recebimento pendente) e a previsão de entrega. Clicar leva
 * para o pedido em Compras. Recomendações de compra vivem na Reposição
 * Inteligente (/compras/reposicao-inteligente) — nunca aqui.
 */
function ReposicaoStatusCell({ s }: { s: SaldoRow }) {
  if (s.reposEstado === "nenhuma" || !s.reposNumero) {
    return <span className="text-[11px] text-faint">—</span>;
  }
  const meta = PEDIDO_STATUS[s.reposEstado];
  const Icon = meta.icon;
  const prazo = s.reposPrevisao ? previsaoLabel(s.reposPrevisao) : null;
  const chegaHoje = prazo === "hoje";
  const outros = s.reposOrdersCount - 1;
  return (
    <Link
      href={`/compras?q=${encodeURIComponent(s.reposNumero)}`}
      onClick={(e) => e.stopPropagation()}
      title={`${meta.label} · ${s.reposNumero}${s.reposSupplierNome ? ` · ${s.reposSupplierNome}` : ""} — ver pedido em Compras`}
      className="-mx-1.5 -my-1 inline-flex flex-col gap-0.5 rounded-lg px-1.5 py-1 transition-colors hover:bg-surface-2"
    >
      <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium", meta.text)}>
        <Icon size={12} className="shrink-0" />
        {meta.label}
        {chegaHoje && <span className="rounded-full bg-brand px-1.5 py-px text-[10px] font-semibold text-on-brand">Chega hoje</span>}
      </span>
      <span className="whitespace-nowrap text-[11px] text-faint">
        {s.reposNumero}
        {s.reposSupplierNome && <> · {s.reposSupplierNome}</>}
        {!chegaHoje && prazo && <> · previsão {prazo}</>}
        {outros > 0 && <> · +{outros} {outros === 1 ? "pedido" : "pedidos"}</>}
      </span>
    </Link>
  );
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

function ProdutoCell({
  s,
  onPendencias,
  onOpen,
}: {
  s: SaldoRow;
  onPendencias?: () => void;
  /** Quando presente, o nome vira botão focável — acesso por teclado nas linhas da tabela. */
  onOpen?: () => void;
}) {
  const st = statusOf(s, usePolicy());
  const cadGaps = dataGaps(s).filter((g) => g !== "local"); // custo, fornecedor
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Thumb url={s.imagemUrl} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          {onOpen ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpen(); }}
              className="min-w-0 truncate rounded text-left font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
            >
              {s.nome}
            </button>
          ) : (
            <p className="truncate font-medium text-ink">{s.nome}</p>
          )}
          {s.tipo === "PERSONALIZADO" && (
            <span className="shrink-0 rounded-full bg-brand-soft px-1.5 py-px text-[10px] font-medium text-brand">
              <Zap size={9} className="-mt-px mr-0.5 inline" />Pers.
            </span>
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
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
          <StatusCell status={st} />
        </div>
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
  const Icon = filtro === "sem" ? PackageCheck : filtro === "aberto" ? PackageOpen : Boxes;
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-line bg-surface py-14 text-center">
      <Icon size={32} className="text-faint" />
      <p className="text-sm font-medium text-muted">
        {busca
          ? "Nenhum produto encontrado para a busca."
          : filtro === "sem"
            ? "Tudo abastecido — nenhum item zerado."
            : filtro === "baixoMinimo"
              ? "Nada abaixo do mínimo."
              : filtro === "repor"
                ? "Nada abaixo do ideal."
                : filtro === "quaseIdeal"
                  ? "Nenhum item perto de precisar reposição."
                  : filtro === "baixaCobertura"
                  ? "Nenhum item com cobertura abaixo da desejada."
                  : filtro === "aberto"
                    ? "Nenhum item com estoque aberto no momento."
                    : filtro !== "todos"
                      ? "Nenhum produto para este filtro."
                      : "Nenhum produto com estoque neste site."}
      </p>
    </div>
  );
}

// ── Painel operacional do produto ─────────────────────────────

/**
 * Rótulos do painel — mais diretos que os da tabela: o operador não quer
 * saber a régua ("Sem estoque"), quer saber o que fazer ("Comprar hoje").
 */
const PANEL_STATUS: Record<Status, { label: string; text: string; dot: string }> = {
  abastecido:  { label: "Abastecido",        text: "text-ok",     dot: "bg-ok"     },
  baixoIdeal:  { label: "Abaixo do ideal",   text: "text-brand",  dot: "bg-brand"  },
  baixoMinimo: { label: "Comprar hoje",      text: "text-danger", dot: "bg-danger" },
  semEstoque:  { label: "Comprar hoje",      text: "text-danger", dot: "bg-danger" },
  semMeta:     { label: "Meta não definida", text: "text-faint",  dot: "bg-faint"  },
  semControle: { label: "Sem controle",      text: "text-faint",  dot: "bg-faint"  },
  coberturaCritica: { label: "Comprar hoje",       text: "text-danger", dot: "bg-danger" },
  coberturaAtencao: { label: "Comprar em breve",   text: "text-brand",  dot: "bg-brand"  },
  semGiro:     { label: "Sem giro recente",  text: "text-faint",  dot: "bg-faint"  },
};

/** "67 unidades disponíveis" / "12 kg disponíveis" — plural correto por unidade. */
function disponivelLabel(s: SaldoRow): string {
  const u = closedUnitLabel(s);
  if (u !== "un") return `${u} disponíveis`;
  return s.estoqueFechado === 1 ? "unidade disponível" : "unidades disponíveis";
}

/** Uma frase sobre a situação do produto, calculada do saldo × meta × giro. */
function fraseSituacao(s: SaldoRow, policy: EstoquePolicy): string {
  const st = statusOf(s, policy);
  if (st === "semControle") return "Produto comprado sem controle de estoque.";
  if (st === "semEstoque")  return "Produto sem estoque — ruptura em curso.";
  if (st === "baixoMinimo") return "Produto em risco de ruptura.";
  if (st === "baixoIdeal")  return "Reposição recomendada nos próximos dias.";
  if (st === "semMeta")     return policy.usaIdeal
    ? "Defina mínimo e ideal para acompanhar a reposição."
    : "Defina o estoque mínimo para acompanhar a reposição.";
  if (st === "semGiro")     return "Sem vendas na janela analisada — o giro ainda não dá para projetar.";
  const cob = diasCobertura(s, policy);
  if (st === "coberturaCritica" || st === "coberturaAtencao") {
    return `Cobertura de ${fmtCobertura(cob)} — abaixo dos ${policy.diasCobertura} dias desejados.`;
  }
  if (cob == null) return "Estoque no ideal. Sem vendas recentes para estimar a cobertura.";
  return `Estoque suficiente para aproximadamente ${cob} ${cob === 1 ? "dia" : "dias"}.`;
}

/**
 * Recomendação do sistema — uma só, por prioridade: evitar compra duplicada
 * vence dizer quanto comprar, que vence a projeção, que vence a unidade aberta.
 * null = nada relevante a dizer (o card some).
 */
function recomendacao(s: SaldoRow, policy: EstoquePolicy): string | null {
  if (semControle(s)) return null;

  if (s.reposEstado !== "nenhuma" && s.reposNumero) {
    const prazo = s.reposPrevisao ? ` Previsão de entrega ${previsaoLabel(s.reposPrevisao)}.` : "";
    return `Já existe um pedido em andamento para este produto (${s.reposNumero}).${prazo}`;
  }

  const st = statusOf(s, policy);
  const m = mediaDia(s, policy);

  // Rotatividade: a quantidade sai do giro × cobertura desejada.
  if (policy.usaGiro) {
    if (m <= 0) return null;
    const falta = necessidadeGiro({
      mediaDia: m,
      estoque: s.estoqueFechado,
      diasCobertura: policy.diasCobertura,
    });
    if (falta > 0) {
      return `Vende ${fmt1(m)} ${closedUnitLabel(s)} por dia. Compre ${fmt(falta)} para cobrir os próximos ${policy.diasCobertura} dias.`;
    }
    return null;
  }

  if (st === "semEstoque" || st === "baixoMinimo") {
    const alvo = policy.usaIdeal && s.estoqueIdeal > 0 ? s.estoqueIdeal : s.estoqueMinimo;
    const falta = alvo > 0 ? alvo - s.estoqueFechado : 0;
    if (falta > 0) {
      const destino = policy.usaIdeal && s.estoqueIdeal > 0 ? "estoque ideal" : "estoque mínimo";
      return `Compre ao menos ${fmt(falta)} ${closedUnitLabel(s)} para voltar ao ${destino}.`;
    }
  }

  if (m > 0 && s.estoqueMinimo > 0 && s.estoqueFechado > s.estoqueMinimo) {
    const dias = Math.round((s.estoqueFechado - s.estoqueMinimo) / m);
    if (dias < 1) return "Com o consumo atual, este produto deve atingir o estoque mínimo ainda hoje.";
    if (dias <= 30) {
      return `Com o consumo atual, este produto deverá atingir o estoque mínimo em aproximadamente ${dias} ${dias === 1 ? "dia" : "dias"}.`;
    }
  }

  if (temAbertaFrac(s)) return "Há uma unidade aberta para consumo. Não é necessário abrir outra.";
  return null;
}

/** Código monoespaçado que se copia com um clique. */
function CodigoCopiavel({ valor, titulo }: { valor: string; titulo: string }) {
  const [copiado, setCopiado] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      timer.current = setTimeout(() => setCopiado(false), 1400);
    } catch {
      toast.error("Não foi possível copiar", "Copie o código manualmente.");
    }
  }

  return (
    <button
      type="button"
      onClick={copiar}
      title={`Copiar ${titulo}`}
      aria-label={`Copiar ${titulo}: ${valor}`}
      className="-mx-1 inline-flex items-center gap-1 rounded px-1 font-mono text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
    >
      {valor}
      {copiado ? <Check size={12} className="text-ok" /> : <Copy size={12} className="text-faint" />}
    </button>
  );
}

function DetalheDrawer({
  saldo,
  initialTab,
  siteId,
  canRepor,
  onClose,
  onEditar,
  onComprar,
  onNovaMovimentacao,
  onAjustado,
}: {
  saldo: SaldoRow | null;
  initialTab: Tab;
  siteId: string | null;
  canRepor: boolean;
  onClose: () => void;
  onEditar: (productId: string) => void;
  onComprar: (s: SaldoRow) => void;
  onNovaMovimentacao: (s: SaldoRow) => void;
  onAjustado: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [ajuste, setAjuste] = useState(false);

  useEffect(() => { if (saldo) { setTab(initialTab); setAjuste(false); } }, [saldo, initialTab]);

  const s = saldo;

  return (
    <Sheet
      open={s !== null}
      onClose={onClose}
      title={s?.nome ?? ""}
      description={
        s && (
          <span className="flex flex-wrap items-center gap-x-1.5">
            <CodigoCopiavel valor={s.sku} titulo="SKU" />
            {s.ean && (
              <>
                <span className="text-faint">·</span>
                <CodigoCopiavel valor={s.ean} titulo="código de barras" />
              </>
            )}
          </span>
        )
      }
      width="lg"
      footer={
        s && (
          <AcoesRodape
            s={s}
            canRepor={canRepor}
            onEditar={onEditar}
            onComprar={onComprar}
            onNovaMovimentacao={onNovaMovimentacao}
          />
        )
      }
    >
      {s && (
        <div className="flex flex-col gap-3.5">
          {/* Abas */}
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
              gaps={dataGaps(s)}
              ajuste={ajuste}
              setAjuste={setAjuste}
              onEditar={onEditar}
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

/**
 * Rodapé fixo. A ordem e o destaque seguem a situação: produto que precisa de
 * reposição abre com "Comprar"; produto abastecido abre com "Movimentação".
 */
function AcoesRodape({
  s,
  canRepor,
  onEditar,
  onComprar,
  onNovaMovimentacao,
}: {
  s: SaldoRow;
  canRepor: boolean;
  onEditar: (productId: string) => void;
  onComprar: (s: SaldoRow) => void;
  onNovaMovimentacao: (s: SaldoRow) => void;
}) {
  const st = statusOf(s, usePolicy());
  const comprarPrimeiro =
    canRepor &&
    (st === "semEstoque" ||
      st === "baixoMinimo" ||
      st === "baixoIdeal" ||
      st === "coberturaCritica" ||
      st === "coberturaAtencao");

  const comprar = canRepor
    ? { key: "comprar", label: "Comprar", Icon: ShoppingCart, onClick: () => onComprar(s) }
    : null;
  const movimentar = { key: "mov", label: "Movimentação", Icon: RefreshCw, onClick: () => onNovaMovimentacao(s) };
  const config = { key: "cfg", label: "Configurações", Icon: Settings2, onClick: () => onEditar(s.productId) };

  const acoes = comprarPrimeiro && comprar
    ? [comprar, movimentar, config]
    : [movimentar, config, ...(comprar ? [comprar] : [])];

  return (
    <div className="flex items-center gap-2">
      {acoes.map(({ key, label, Icon, onClick }, i) => (
        <button
          key={key}
          type="button"
          onClick={onClick}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-full text-sm transition-colors",
            i === 0
              ? "flex-1 bg-brand px-4 py-2.5 font-semibold text-on-brand hover:bg-brand-strong"
              : "border border-line bg-surface px-3.5 py-2.5 font-medium text-ink hover:bg-surface-2",
          )}
        >
          <Icon size={14} className={i === 0 ? "" : "text-muted"} /> {label}
        </button>
      ))}
    </div>
  );
}

/** Célula do medidor de 4 indicadores (linguagem do operador, sem jargão). */
function Indicador({ label, value, tone }: { label: string; value: string; tone?: "ink" | "faint" }) {
  return (
    <div className="px-3 py-2.5 text-center">
      <p className="text-[10px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className={cn(
        "mt-0.5 truncate font-mono text-sm font-semibold tabular-nums",
        tone === "faint" ? "text-faint" : "text-ink",
      )}>
        {value}
      </p>
    </div>
  );
}

function ResumoTab({
  s,
  siteId,
  gaps,
  ajuste,
  setAjuste,
  onEditar,
  onAjustado,
}: {
  s: SaldoRow;
  siteId: string | null;
  gaps: ("custo" | "fornecedor" | "local")[];
  ajuste: boolean;
  setAjuste: (b: boolean) => void;
  onEditar: (productId: string) => void;
  onAjustado: () => void;
}) {
  const policy = usePolicy();
  const status = PANEL_STATUS[statusOf(s, policy)];
  const un = closedUnitLabel(s);
  const cob = diasCobertura(s, policy);
  const base = s.custo ?? s.custoMedio;
  const margem = s.precoVenda != null && s.precoVenda > 0 && base != null
    ? ((s.precoVenda - base) / s.precoVenda) * 100
    : null;
  const semGiro = s.consumoHoje === 0 && s.consumo7 === 0 && s.consumo30 === 0;
  const dica = recomendacao(s, policy);
  const [comercialAberto, setComercialAberto] = useState(false);

  const gapMsg: Record<"custo" | "fornecedor" | "local", string> = {
    local: "sem localização",
    custo: "sem custo",
    fornecedor: "sem fornecedor",
  };

  return (
    <div className="flex flex-col gap-3">
      {/* ── Situação: entender o produto em menos de 5 segundos ── */}
      <div className="rounded-xl border border-line bg-surface-2/50 p-3.5">
        <div className="flex items-start gap-3">
          <Thumb url={s.imagemUrl} size={44} />
          <div className="min-w-0 flex-1">
            <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-semibold", status.text)}>
              <span className={cn("h-2 w-2 shrink-0 rounded-full", status.dot)} aria-hidden />
              {status.label}
            </span>
            <p className="mt-0.5 truncate text-xs text-muted">
              {[s.marca, s.categoria, TIPO_LABEL[s.tipo] ?? s.tipo].filter(Boolean).join(" · ")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAjuste(!ajuste)}
            aria-pressed={ajuste}
            title="Ajustar saldo por contagem"
            aria-label="Ajustar saldo por contagem"
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-colors",
              ajuste ? "border-brand bg-brand-soft text-brand" : "border-line bg-surface text-muted hover:text-ink",
            )}
          >
            <SlidersHorizontal size={14} />
          </button>
        </div>

        <p className="mt-2.5 flex flex-wrap items-baseline gap-x-1.5">
          <span className="font-mono text-2xl font-bold tabular-nums text-ink">{fmt(s.estoqueFechado)}</span>
          <span className="text-sm text-muted">{disponivelLabel(s)}</span>
        </p>

        {s.estoqueAberto > 0 && (
          <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
            <PackageOpen size={12} className="shrink-0" />
            {temAbertaFrac(s)
              ? `1 unidade aberta · restam ${fmtVol(s.estoqueAberto, s.unidadeBase.toLowerCase())}`
              : "1 unidade aberta"}
          </span>
        )}

        <p className="mt-1.5 text-[13px] text-ink-2">{fraseSituacao(s, policy)}</p>
      </div>

      {/* Ajuste por contagem — acionado pelo botão da situação */}
      <AjusteInline s={s} siteId={siteId} onAjustado={onAjustado} aberta={ajuste} setAberta={setAjuste} />

      {/* ── Indicadores: um único medidor, sem cards soltos ── */}
      {/* As metas exibidas seguem a estratégia da empresa; a última coluna é
          sempre a cobertura, que faz sentido em qualquer modelo. */}
      <div className={cn("grid divide-x divide-line rounded-xl border border-line bg-surface", policy.usaIdeal ? "grid-cols-4" : "grid-cols-3")}>
        <Indicador label="Disponível" value={`${fmt(s.estoqueFechado)} ${un}`} />
        {policy.usaMinimo && (
          <Indicador
            label="Mínimo"
            value={s.estoqueMinimo > 0 ? `${fmt(s.estoqueMinimo)} ${un}` : "—"}
            tone={s.estoqueMinimo > 0 ? "ink" : "faint"}
          />
        )}
        {policy.usaIdeal && (
          <Indicador
            label="Ideal"
            value={s.estoqueIdeal > 0 ? `${fmt(s.estoqueIdeal)} ${un}` : "—"}
            tone={s.estoqueIdeal > 0 ? "ink" : "faint"}
          />
        )}
        {policy.usaGiro && (
          <>
            <Indicador
              label="Média diária"
              value={mediaDia(s, policy) > 0 ? `${fmt1(mediaDia(s, policy))} ${un}` : "—"}
              tone={mediaDia(s, policy) > 0 ? "ink" : "faint"}
            />
            <Indicador label="Desejada" value={`${policy.diasCobertura} dias`} />
          </>
        )}
        <Indicador
          label="Cobertura"
          value={cob != null ? `${cob} ${cob === 1 ? "dia" : "dias"}` : "—"}
          tone={cob != null ? "ink" : "faint"}
        />
      </div>

      {policy.usaGiro && mediaDia(s, policy) <= 0 && (
        <p className="rounded-xl border border-dashed border-line px-3.5 py-2.5 text-[12px] text-muted">
          {MSG_APRENDIZADO}
        </p>
      )}

      {/* ── Consumo: uma linha, sem card alto ── */}
      <div className="rounded-xl border border-line bg-surface px-3.5 py-2.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-faint">Consumo</h3>
        {semGiro ? (
          <p className="mt-1 text-[12px] text-muted">Ainda não há consumo suficiente para calcular a média.</p>
        ) : (
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[13px] tabular-nums text-ink">
            <span><span className="text-muted">Hoje</span> <b>{fmt(s.consumoHoje)}</b></span>
            <span className="text-faint" aria-hidden>•</span>
            <span><span className="text-muted">7 dias</span> <b>{fmt1(s.consumo7 / 7)}</b><span className="text-faint">/dia</span></span>
            <span className="text-faint" aria-hidden>•</span>
            <span><span className="text-muted">30 dias</span> <b>{fmt1(s.consumo30 / 30)}</b><span className="text-faint">/dia</span></span>
          </div>
        )}
      </div>

      {/* ── Cadastro incompleto — uma linha, some quando resolvido ── */}
      {gaps.length > 0 && (
        <button
          type="button"
          onClick={() => onEditar(s.productId)}
          className="flex items-center gap-2 rounded-xl border border-warn/30 bg-warn-soft/40 px-3.5 py-2 text-left text-[12px] text-ink-2 transition-colors hover:bg-warn-soft/70"
        >
          <AlertTriangle size={14} className="shrink-0 text-warn" />
          <span className="min-w-0 flex-1 truncate">
            Cadastro incompleto: {gaps.map((g) => gapMsg[g]).join(", ")}
          </span>
          <span className="shrink-0 font-semibold text-warn">Completar</span>
        </button>
      )}

      {/* ── Dados comerciais — recolhido, dado de menor uso no dia a dia ── */}
      <div className="rounded-xl border border-line bg-surface">
        <button
          type="button"
          onClick={() => setComercialAberto((v) => !v)}
          aria-expanded={comercialAberto}
          className="flex w-full items-center justify-between px-3.5 py-2.5 text-left"
        >
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-faint">Dados comerciais</h3>
          <ChevronDown size={15} className={cn("text-faint transition-transform", comercialAberto && "rotate-180")} />
        </button>
        {comercialAberto && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-3.5 pb-3.5">
            <Field label="Preço venda" value={s.precoVenda != null ? fmtMoney(s.precoVenda) : "—"} />
            <Field label="Preço custo" value={base != null ? fmtMoney(base) : "—"} />
            <Field
              label="Margem"
              value={margem != null ? `${fmt1(margem)}%` : "—"}
              tone={margem != null && margem > 0 ? "ok" : undefined}
            />
            <Field label="Fornecedor" value={s.fornecedorNome ?? "—"} />
            <Field label="Última compra" value={s.ultimaCompraEm ? fmtDate(s.ultimaCompraEm) : "—"} />
            <Field label="Valor em estoque" value={s.custoMedio != null ? fmtMoney(valorEstoque(s)) : "—"} />
          </dl>
        )}
      </div>

      {/* ── Recomendação — só quando há algo relevante a dizer ── */}
      {dica && (
        <div className="rounded-xl border border-info/25 bg-info-soft/50 px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-info">
            <Lightbulb size={13} /> Recomendação
          </div>
          <p className="mt-1 text-[13px] text-ink-2">{dica}</p>
        </div>
      )}
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
      toast.success(
        "Saldo ajustado",
        `${s.nome}: ${fmt(s.estoqueFechado)} → ${fmt(nova)} un`,
      );
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
          {!podeEnviar && !pending && (
            <p className="text-[11px] text-faint">
              {!Number.isFinite(nova)
                ? "Informe um número válido na contagem."
                : delta === 0
                  ? "Contagem igual ao saldo atual — nada a ajustar."
                  : "Informe o motivo do ajuste (mínimo 3 caracteres)."}
            </p>
          )}
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

// Janela do histórico é preferência do operador, não do produto — persiste
// entre trocas de produto (o drawer remonta a cada abertura).
type Janela = 7 | 15 | 30 | "todos";
let historicoJanelaPreferida: Janela = 7;

const PAGINA_HISTORICO = 25;

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
  const [janela, setJanelaState] = useState<Janela>(historicoJanelaPreferida);
  const [limite, setLimite] = useState(PAGINA_HISTORICO);
  const setJanela = (j: Janela) => { historicoJanelaPreferida = j; setJanelaState(j); setLimite(PAGINA_HISTORICO); };

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    fetchHistoricoProductAction(productId, siteId)
      .then((d) => { if (vivo) setItems(d); })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [productId, siteId]);

  const unidade = unidadeBase.toLowerCase();
  const corte = janela === "todos" ? 0 : Date.now() - janela * 24 * 60 * 60 * 1000;
  const naJanela = (items ?? []).filter((m) => new Date(m.createdAt).getTime() >= corte);
  const visiveis = naJanela.slice(0, limite);
  const temMais = naJanela.length > visiveis.length;

  // Scroll infinito: a sentinela entra em cena ⇒ revela o próximo lote.
  const sentinela = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const alvo = sentinela.current;
    if (!alvo || !temMais) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setLimite((n) => n + PAGINA_HISTORICO); },
      { rootMargin: "200px" },
    );
    obs.observe(alvo);
    return () => obs.disconnect();
  }, [temMais, visiveis.length]);

  const JANELAS: [Janela, string][] = [[7, "7 dias"], [15, "15 dias"], [30, "30 dias"], ["todos", "Todos"]];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {JANELAS.map(([j, lbl]) => (
          <button
            key={String(j)}
            type="button"
            onClick={() => setJanela(j)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              janela === j ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:bg-surface-2",
            )}
          >
            {lbl}
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
          <p className="text-sm font-medium text-muted">
            {janela === "todos"
              ? "Este produto ainda não tem movimentações."
              : `Nenhuma movimentação nos últimos ${janela} dias.`}
          </p>
        </div>
      ) : (
        <>
          <ol className="divide-y divide-line">
            {visiveis.map((m) => {
              const meta = TIPO_MOV[m.tipo] ?? { label: m.tipo, cor: "text-muted" };
              const positivoF = m.deltaFechado > 0;
              const positivoA = m.deltaAberto > 0;
              const sub = getMovSub(m);
              return (
                <li key={m.id} className="flex items-start gap-2.5 py-2.5">
                  <span className={cn("mt-px shrink-0", meta.cor)}>
                    <MovIcon tipo={m.tipo} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className={cn("truncate text-[13px] font-semibold", meta.cor)}>{getMovLabel(m)}</span>
                      {m.deltaFechado !== 0 ? (
                        <span className={cn("shrink-0 text-[13px] font-semibold tabular-nums", positivoF ? "text-ok" : "text-danger")}>
                          {positivoF ? "+" : ""}{fmt(m.deltaFechado)} un
                        </span>
                      ) : m.deltaAberto !== 0 ? (
                        <span className={cn("shrink-0 text-[13px] font-semibold tabular-nums", positivoA ? "text-ok" : "text-danger")}>
                          {positivoA ? "+" : ""}{fmt(m.deltaAberto)} {unidade}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] tabular-nums text-faint">
                      {fmtMovData(m.createdAt)}
                      {sub && <> · <span className="text-muted">{sub}</span></>}
                      {m.deltaFechado !== 0 && m.deltaAberto !== 0 && (
                        <> · {positivoA ? "+" : ""}{fmt(m.deltaAberto)} {unidade}</>
                      )}
                    </p>
                    {m.observacao && <p className="mt-0.5 truncate text-[11px] italic text-muted">{m.observacao}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          {temMais && (
            <div ref={sentinela} className="flex justify-center py-3" aria-hidden>
              <Loader2 size={16} className="animate-spin text-faint" />
            </div>
          )}
        </>
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
