"use client";

import {
  createContext,
  Fragment,
  useCallback,
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
  Check as CheckIcon,
  ChevronUp,
  FileSpreadsheet,
  Lightbulb,
  Rows2,
  Rows3,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  APRENDIZADO_DIAS,
  MSG_APRENDIZADO,
  POLICY_PADRAO,
  estaAprendendo,
  fmtCobertura,
  mediaDiaria,
  necessidadeGiro,
  nivelCobertura,
  type EstoquePolicy,
} from "@/lib/estoque-estrategia";
import { toast } from "@/components/ui/toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet } from "@/components/ui/sheet";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Input, Select } from "@/components/ui/input";
import { NovaEntradaForm, type Item } from "../entradas/nova/_client";
import { AdicionarCompraSheet } from "./_comprar";
import { FILTRO_LABEL, FILTRO_TOM, filtroValido, filtrosDaPolicy, type Filtro } from "../_filtros";
import { baixarXlsx } from "@/lib/baixar-xlsx";
import {
  SelecaoProvider, useNovaSelecao, useQtdDaPagina, useQtdSelecionada, useSelecao, useSelecionado,
} from "@/components/app/selecao";
import { PEDIDO_STATUS } from "../../cotacoes/_ui";
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
  | "aprendendo"
  | "semGiro";

/** Contexto da estratégia — evita passar policy por dez níveis de componente. */
const PolicyCtx = createContext<EstoquePolicy>(POLICY_PADRAO);
const usePolicy = () => useContext(PolicyCtx);

/** Produto marcado para não controlar estoque — some do funil de meta/urgência, só informa qtd comprada. */
// A consulta já exclui produto inativo e produto sem controle de estoque
// (loadSaldos). O tratamento segue aqui como rede: se um Stock chegar por outro
// caminho, ele informa em vez de entrar no funil de meta/urgência.
const semControle = (s: SaldoRow) => !s.controlaEstoque;

function statusOf(s: SaldoRow, policy: EstoquePolicy): Status {
  if (semControle(s)) return "semControle";
  const f = s.estoqueFechado;
  if (f <= 0 && s.estoqueAberto <= 0) return "semEstoque";

  if (policy.usaGiro) {
    const cob = diasCobertura(s, policy);
    const nivel = nivelCobertura(cob, policy.diasCobertura);
    // Histórico curto demais: a média ainda não descreve o produto — informa em
    // vez de alarmar. Exceção: cobertura crítica passa assim mesmo (ruptura
    // iminente é ruptura, mesmo estimada por poucos dias de venda).
    if (aprendendo(s, policy) && nivel !== "muito-baixo") return "aprendendo";
    if (cob == null) return "semGiro";
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
  aprendendo:  { label: "Aprendendo",       text: "text-faint",  dot: "bg-faint",  bar: "bg-faint",  Icon: Lightbulb },
  semGiro:     { label: "Sem giro",         text: "text-faint",  dot: "bg-faint",  bar: "bg-faint",  Icon: PackageX },
};

// Todo filtro de situação deriva do status — e o status já respeita a
// estratégia. Assim nenhuma contagem usa uma régua que a empresa não usa, e as
// faixas ficam exclusivas entre si (zerado conta só em "Sem estoque", nunca
// também em "Abaixo do mínimo").
const semEstoque = (s: SaldoRow, policy: EstoquePolicy) => statusOf(s, policy) === "semEstoque";
const abaixoMin = (s: SaldoRow, policy: EstoquePolicy) => statusOf(s, policy) === "baixoMinimo";
const precisaRepor = (s: SaldoRow, policy: EstoquePolicy) => statusOf(s, policy) === "baixoIdeal";
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

/** Dias desde o cadastro — proxy do histórico de venda disponível para a média. */
function diasHistorico(s: SaldoRow): number {
  return Math.max(0, Math.floor((Date.now() - new Date(s.criadoEm).getTime()) / 864e5));
}

/** Produto novo demais para a média de giro dizer alguma coisa (≠ "sem giro"). */
function aprendendo(s: SaldoRow, policy: EstoquePolicy): boolean {
  return estaAprendendo(policy, diasHistorico(s));
}

/** Linha em vermelho: abaixo do mínimo ou cobertura crítica, conforme a estratégia. */
function critico(s: SaldoRow, policy: EstoquePolicy): boolean {
  const st = statusOf(s, policy);
  return st === "baixoMinimo" || st === "coberturaCritica";
}

/** Cobertura abaixo da desejada — o "precisa repor" do modo rotatividade. */
function baixaCobertura(s: SaldoRow, policy: EstoquePolicy): boolean {
  // Deriva do status para herdar a regra do "aprendendo" — alarmar por uma
  // média de três dias seria ruído, não sinal.
  const st = statusOf(s, policy);
  return st === "coberturaCritica" || st === "coberturaAtencao";
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
  aprendendo: 3,
  abastecido: 4,
  semControle: 5,
};

// ── Exportação (CSV e planilha) ───────────────────────────────
// Um catálogo de colunas só, nos dois formatos: planilha que não bate com o CSV
// é planilha que ninguém confere. As colunas de meta seguem a estratégia —
// quem controla por giro exporta média e cobertura, não mínimo/ideal.

type ColunaExport = { titulo: string; valor: (s: SaldoRow) => string | number | null };

function colunasExport(policy: EstoquePolicy): ColunaExport[] {
  return [
    { titulo: "Produto", valor: (s) => s.nome },
    { titulo: "Tipo", valor: (s) => TIPO_LABEL[s.tipo] ?? s.tipo },
    { titulo: "SKU", valor: (s) => s.sku },
    { titulo: "Codigo de barras", valor: (s) => s.ean ?? "" },
    { titulo: "Categoria", valor: (s) => s.categoriaNome ?? "" },
    { titulo: "Subcategoria", valor: (s) => s.categoria ?? "" },
    { titulo: "Marca", valor: (s) => s.marca ?? "" },
    { titulo: "Fornecedor", valor: (s) => s.fornecedorNome ?? "" },
    { titulo: "Fechado", valor: (s) => s.estoqueFechado },
    { titulo: "Aberto", valor: (s) => s.estoqueAberto },
    { titulo: "Disponivel", valor: (s) => disponivel(s) },
    ...(policy.usaMinimo ? [{ titulo: "Minimo", valor: (s: SaldoRow) => s.estoqueMinimo }] : []),
    ...(policy.usaIdeal ? [{ titulo: "Ideal", valor: (s: SaldoRow) => s.estoqueIdeal }] : []),
    ...(policy.usaGiro
      ? [
          { titulo: "Media diaria", valor: (s: SaldoRow) => mediaDia(s, policy) },
          { titulo: "Cobertura (dias)", valor: (s: SaldoRow) => diasCobertura(s, policy) },
          { titulo: "Cobertura desejada", valor: () => policy.diasCobertura },
        ]
      : []),
    { titulo: "Custo medio", valor: (s) => s.custoMedio ?? 0 },
    { titulo: "Valor em estoque", valor: (s) => valorEstoque(s) },
    { titulo: "Local", valor: (s) => s.locationNome ?? "" },
  ];
}

const nomeArquivoExport = (ext: string) => `saldos-${new Date().toISOString().slice(0, 10)}.${ext}`;

function baixarArquivo(conteudo: BlobPart, tipo: string, nome: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

/** CSV com separador ";" e decimal com vírgula — o que o Excel pt-BR abre direto. */
function baixarCsv(rows: SaldoRow[], policy: EstoquePolicy) {
  const colunas = colunasExport(policy);
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const cel = (v: string | number | null) =>
    v == null ? "" : typeof v === "number"
      ? v.toLocaleString("pt-BR", { maximumFractionDigits: 3, useGrouping: false })
      : esc(v);
  const linhas = [
    colunas.map((c) => c.titulo).join(";"),
    ...rows.map((s) => colunas.map((c) => cel(c.valor(s))).join(";")),
  ];
  // BOM: sem ele o Excel abre o arquivo em ANSI e come os acentos.
  baixarArquivo("﻿" + linhas.join("\r\n"), "text/csv;charset=utf-8", nomeArquivoExport("csv"));
}

/** Planilha: número vai como número, para o operador somar sem converter nada. */
function baixarPlanilha(rows: SaldoRow[], policy: EstoquePolicy) {
  const colunas = colunasExport(policy);
  baixarXlsx({
    nomeArquivo: nomeArquivoExport("xlsx"),
    aba: "Saldos",
    cabecalho: colunas.map((c) => c.titulo),
    linhas: rows.map((s) => colunas.map((c) => c.valor(s))),
  });
}

// ── Colunas configuráveis (persistidas no navegador, não na URL) ─────────────
type ColKey = "local" | "fornecedor" | "aberto" | "pedido";
const COL_ORDER: ColKey[] = ["local", "aberto", "fornecedor", "pedido"];
const COL_LABEL: Record<ColKey, string> = {
  local: "Local", fornecedor: "Fornecedor", aberto: "Aberto (consumo/drinks)", pedido: "Pedido",
};
const DEFAULT_COLS: Record<ColKey, boolean> = { local: true, fornecedor: true, aberto: true, pedido: true };

/** Densidade da tabela — "denso" é a versão simples, sem miniatura. */
type Density = "denso" | "compact";

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
  const [filtroState, setFiltro] = useState<Filtro>(initialFiltro);
  // A estratégia pode mudar sob os pés (troca em outra aba + refresh): filtro
  // que deixou de existir na régua nova vira "todos" em vez de lista vazia.
  const filtro = filtroValido(filtroState, policy);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);
  const [entradaItems, setEntradaItems] = useState<Item[] | null>(null);
  const [entradaLoading, setEntradaLoading] = useState(false);
  // Compra manual — o operador escolhe produtos e o sistema só registra.
  const [comprarIds, setComprarIds] = useState<string[] | null>(null);
  // Seleção fora do React (mesma loja de /produtos): marcar uma caixa numa
  // página de 100 linhas re-renderiza a caixa, não a tabela.
  const selecao = useNovaSelecao();
  const [detalhe, setDetalhe] = useState<{ row: SaldoRow; tab: Tab } | null>(null);
  const [page, setPage] = useState(initialPage);
  // 50 por página: a conferência de estoque é varredura, não leitura de uma
  // linha — rolar pesa menos que paginar de 25 em 25.
  const [pageSize, setPageSize] = useState(50);

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

  // Densidade: "Densa" tira a miniatura e aperta a linha — quem confere estoque
  // pelo nome/SKU vê o dobro de produtos sem rolar.
  const [density, setDensity] = useState<Density>(() => readLS("estoque:ui", { density: "compact" as Density }).density);
  useEffect(() => { try { localStorage.setItem("estoque:ui", JSON.stringify({ density })); } catch {} }, [density]);
  const denso = density === "denso";
  const cellPad = denso ? "py-1" : "py-2";

  // Uma passada, um statusOf por produto — as contagens não podem divergir do
  // que a linha mostra.
  const counts = useMemo(() => {
    let sem = 0, baixoMinimo = 0, repor = 0, quaseIdealN = 0, cobertura = 0, aberto = 0, semlocal = 0, pendencias = 0, comEstoque = 0, semMeta = 0;
    for (const s of saldos) {
      const st = statusOf(s, policy);
      if (st === "semEstoque") sem++; else comEstoque++;
      if (st === "baixoMinimo") baixoMinimo++;
      if (st === "baixoIdeal") repor++;
      if (st === "coberturaCritica" || st === "coberturaAtencao") cobertura++;
      if (st === "semMeta") semMeta++;
      if (quaseIdeal(s, policy)) quaseIdealN++;
      if (temEstoqueAberto(s)) aberto++;
      if (!s.locationNome) semlocal++;
      if (dataGaps(s).length > 0) pendencias++;
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

  // Categoria/subcategoria como em /produtos: a categoria é uma opção que filtra
  // tudo dela, com as subcategorias indentadas logo abaixo. A árvore sai dos
  // próprios saldos — nenhuma consulta extra.
  const arvoreCategorias = useMemo(() => {
    const cats = new Map<string, { id: string; nome: string; subs: Map<string, string> }>();
    for (const s of saldos) {
      if (!s.categoriaId || !s.categoriaNome) continue;
      let c = cats.get(s.categoriaId);
      if (!c) {
        c = { id: s.categoriaId, nome: s.categoriaNome, subs: new Map() };
        cats.set(s.categoriaId, c);
      }
      if (s.subcategoriaId && s.categoria) c.subs.set(s.subcategoriaId, s.categoria);
    }
    return [...cats.values()]
      .sort((a, b) => a.nome.localeCompare(b.nome))
      .map((c) => ({
        ...c,
        subs: [...c.subs.entries()]
          .map(([id, nome]) => ({ id, nome }))
          .sort((a, b) => a.nome.localeCompare(b.nome)),
      }));
  }, [saldos]);
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
        case "baixoMinimo":    if (!abaixoMin(s, policy)) return false; break;
        case "repor":          if (!precisaRepor(s, policy)) return false; break;
        case "quaseIdeal":     if (!quaseIdeal(s, policy)) return false; break;
        case "baixaCobertura": if (!baixaCobertura(s, policy)) return false; break;
        case "aberto":         if (!temEstoqueAberto(s)) return false; break;
      }
      if (avComEstoque && semEstoque(s, policy)) return false;
      if (avSemLocal && s.locationNome) return false;
      if (avSemMeta && statusOf(s, policy) !== "semMeta") return false;
      if (avPendenciaCadastro && dataGaps(s).length === 0) return false;
      // "cat:<id>" pega a categoria inteira; qualquer outro valor é subcategoria.
      if (avCategoria) {
        if (avCategoria.startsWith("cat:")) {
          if (s.categoriaId !== avCategoria.slice(4)) return false;
        } else if (s.subcategoriaId !== avCategoria) return false;
      }
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
        // Na rotatividade a coluna mostra dias, então ordena por dias — ordenar
        // por unidades ali deixaria o topo da lista mentindo.
        const f = (s: SaldoRow) =>
          sort.key === "nome" ? s.nome.toLowerCase()
          : sort.key === "fechado"
            ? policy.usaGiro ? (diasCobertura(s, policy) ?? Number.POSITIVE_INFINITY) : s.estoqueFechado
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
    const ids = selecao.lista();
    if (!siteId || ids.length === 0 || localSalvando) return;
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
      selecao.limpar();
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
  // `lista` é o que está na página: shift-clique marca o intervalo, como em
  // /produtos ("essa prateleira inteira" sem 40 cliques).
  const pageIds = useMemo(() => pageRows.map((s) => s.productId), [pageRows]);
  const listaDaPagina = useMemo(() => pageIds.map((id) => ({ id })), [pageIds]);
  const toggleRow = useCallback(
    (id: string, idx: number, shift: boolean) => selecao.alternar(id, idx, shift, listaDaPagina),
    [selecao, listaDaPagina],
  );

  /** Exporta o que está marcado — a lista inteira filtrada quando nada está. */
  function exportarSelecionados(formato: "csv" | "xlsx") {
    const marcados = new Set(selecao.lista());
    const alvo = marcados.size > 0 ? saldos.filter((s) => marcados.has(s.productId)) : filtrados;
    if (formato === "xlsx") baixarPlanilha(alvo, policy);
    else baixarCsv(alvo, policy);
  }

  type Pill = { key: Filtro; label: string; count: number; tone: "neutral" | "danger" | "warn" | "brand" };
  // Catálogo por estratégia (_filtros.ts) — a mesma lista que sanea o `?filtro=`
  // da URL, para tela e link nunca discordarem sobre o que existe.
  const pillsEstoque: Pill[] = filtrosDaPolicy(policy).map((k) => ({
    key: k,
    label: FILTRO_LABEL[k],
    count: counts[k],
    tone: FILTRO_TOM[k],
  }));

  return (
   <PolicyCtx.Provider value={policy}>
    <SelecaoProvider store={selecao}>
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

        {arvoreCategorias.length > 0 && (
          <Select value={avCategoria} onChange={(e) => setAvCategoria(e.target.value)} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
            <option value="">Toda categoria</option>
            {/* Mesmo desenho de /produtos: a categoria é opção clicável (optgroup
                não é) e as subcategorias vêm recuadas com espaço inseparável — o
                navegador engole espaço comum dentro de <option>. */}
            {arvoreCategorias.map((c) => (
              <Fragment key={c.id}>
                <option value={`cat:${c.id}`} style={{ fontWeight: 600 }}>{c.nome}</option>
                {c.subs.map((s) => (
                  <option key={s.id} value={s.id} style={{ fontWeight: 400 }}>
                    {"    "}{s.nome}
                  </option>
                ))}
              </Fragment>
            ))}
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
          <div className="my-1 h-px bg-line" role="separator" />
          <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">Densidade</p>
          <div className="flex gap-1 px-1.5 pb-1">
            <DensityBtn active={denso} onClick={() => setDensity("denso")} icon={<Rows3 size={14} />}>Densa</DensityBtn>
            <DensityBtn active={!denso} onClick={() => setDensity("compact")} icon={<Rows2 size={14} />}>Média</DensityBtn>
          </div>
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
                  {/* Coluna da caixa estreita e Produto colado nela: o nome é a
                      âncora de leitura da linha, não pode começar no meio. */}
                  <th className="w-8 pl-2 pr-0 py-2">
                    <CheckDaPagina ids={pageIds} />
                  </th>
                  <Th label="Produto" sortKey="nome" sort={sort} onSort={toggleSort} className="pl-2" />
                  {cols.local && <th className="px-4 py-2">Local</th>}
                  <Th
                    label={policy.usaGiro ? "Cobertura" : "Estoque"}
                    sortKey="fechado"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  {cols.aberto && (
                    <th className="hidden px-4 py-2 lg:table-cell">
                      {/* Qualificador na linha de baixo, menor e em caixa baixa:
                          explica a coluna sem alargá-la nem competir com o nome. */}
                      <span className="flex flex-col leading-tight" title="Conteúdo restante da unidade aberta, vendida em doses/drinks">
                        <span className="inline-flex items-center gap-1">
                          Aberto
                          <Info size={12} className="text-faint" aria-label="Conteúdo restante da unidade aberta, vendida em doses/drinks" />
                        </span>
                        <span className="text-[10px] font-medium normal-case tracking-normal text-faint">
                          (consumo/drinks)
                        </span>
                      </span>
                    </th>
                  )}
                  {cols.fornecedor && <th className="hidden px-4 py-2 md:table-cell">Fornecedor</th>}
                  {cols.pedido && <th className="hidden px-4 py-2 md:table-cell">Pedido</th>}
                  <th className="w-px px-3 py-2" aria-hidden />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pageRows.map((s, idx) => (
                  // O realce de "marcada" sai do CSS (`:has`), não do React: é o
                  // que permite marcar a caixa sem redesenhar a linha inteira.
                  <tr
                    key={s.productId}
                    onClick={() => abrir(s)}
                    className={cn(
                      "group cursor-pointer transition-colors hover:bg-surface-2 has-[input:checked]:bg-brand-soft/40",
                      critico(s, policy) && "bg-danger-soft/40",
                    )}
                  >
                    <td className={cn("pl-2 pr-0", cellPad)} onClick={(e) => e.stopPropagation()}>
                      <CheckLinha
                        id={s.productId}
                        idx={idx}
                        onToggle={toggleRow}
                        label={`Selecionar ${s.nome}`}
                      />
                    </td>
                    <td className={cn("pl-2 pr-4", cellPad)}>
                      <ProdutoCell
                        s={s}
                        denso={denso}
                        onOpen={() => abrir(s)}
                        onPendencias={() => router.push(`/produtos/${s.productId}/editar`)}
                      />
                    </td>
                    {cols.local && (
                      <td className={cn("px-4", cellPad)}>
                        <LocalCell s={s} />
                      </td>
                    )}
                    <td className={cn("px-4", cellPad)}>
                      <EstoqueCell s={s} />
                    </td>
                    {cols.aberto && (
                      <td className={cn("hidden px-4 lg:table-cell", cellPad)}>
                        <AbertaCell s={s} />
                      </td>
                    )}
                    {cols.fornecedor && (
                      <td className={cn("hidden px-4 md:table-cell", cellPad)}>
                        <FornecedorCell s={s} />
                      </td>
                    )}
                    {cols.pedido && (
                      <td className={cn("hidden px-4 md:table-cell", cellPad)}>
                        <ReposicaoStatusCell s={s} />
                      </td>
                    )}
                    <td className={cn("px-3 text-right", cellPad)}>
                      <ChevronRight size={16} className="ml-auto shrink-0 text-faint transition-colors group-hover:text-ink" />
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Sem tfoot de total: o rodapé de paginação já diz "1–50 de N
                  produtos", e contar duas vezes a mesma coisa na mesma tela só
                  faz o operador conferir se batem. */}
            </table>
          </div>

          {/* ── Cards (mobile) ── */}
          <div className="mt-4 flex flex-col gap-2.5 md:hidden">
            {pageRows.map((s, idx) => (
              <div
                key={s.productId}
                role="button"
                tabIndex={0}
                onClick={() => abrir(s)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(s); } }}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) has-[input:checked]:border-brand/50 has-[input:checked]:bg-brand-soft/20",
                  critico(s, policy) ? "border-danger/30 bg-danger-soft/30" : "border-line bg-surface",
                )}
              >
                <span className="mt-1 shrink-0">
                  <CheckLinha
                    id={s.productId}
                    idx={idx}
                    onToggle={toggleRow}
                    label={`Selecionar ${s.nome}`}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <ProdutoCell s={s} denso={denso} onPendencias={() => router.push(`/produtos/${s.productId}/editar`)} />
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
      <BulkBar
        siteId={siteId}
        locais={locais}
        localSalvando={localSalvando}
        onLocal={aplicarLocal}
        onComprar={() => setComprarIds(selecao.lista())}
        onExportar={exportarSelecionados}
      />

      {/* ── Sidepanel — compra manual (sem sugestões) ── */}
      <AdicionarCompraSheet
        open={comprarIds !== null}
        produtoIds={comprarIds ?? []}
        siteId={siteId}
        onClose={() => setComprarIds(null)}
        onDone={() => {
          setComprarIds(null);
          selecao.limpar();
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
    </SelecaoProvider>
   </PolicyCtx.Provider>
  );
}

// ── Barra de ações em lote (flutuante) ────────────────────────
// Fora da listagem de propósito: assina só o total, então marcar uma caixa não
// re-renderiza a tabela. É onde mora o "Exportar" — exportar é ação sobre o que
// está selecionado, não um botão de barra de filtro.

function BulkBar({
  siteId,
  locais,
  localSalvando,
  onLocal,
  onComprar,
  onExportar,
}: {
  siteId: string | null;
  locais: LocalArmazenagemRow[];
  localSalvando: boolean;
  onLocal: (local: LocalArmazenagemRow | null) => void;
  onComprar: () => void;
  onExportar: (formato: "csv" | "xlsx") => void;
}) {
  const selecao = useSelecao();
  const count = useQtdSelecionada();
  if (count === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-full border border-line bg-surface py-2 pl-4 pr-2 shadow-(--shadow-2)">
        <span className="text-sm font-medium text-ink">
          <b className="tabular-nums">{count}</b>{" "}
          {count === 1 ? "produto selecionado" : "produtos selecionados"}
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
                  onClick={() => onLocal(l)}
                >
                  {l.nome}
                </MenuItem>
              );
            })}
            <div className="my-1 h-px bg-line" />
            <MenuItem icon={<X size={14} />} onClick={() => onLocal(null)}>
              Sem local
            </MenuItem>
          </Menu>
        )}
        <Menu
          align="end"
          trigger={
            <button
              type="button"
              className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Download size={14} /> Exportar
              <ChevronUp size={13} className="text-faint" />
            </button>
          }
        >
          <MenuItem icon={<FileSpreadsheet size={15} />} onClick={() => onExportar("xlsx")}>
            Planilha (.xlsx)
          </MenuItem>
          <MenuItem icon={<Download size={15} />} onClick={() => onExportar("csv")}>
            CSV
          </MenuItem>
        </Menu>
        <button
          type="button"
          onClick={onComprar}
          className="flex cursor-pointer items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
        >
          <ShoppingCart size={14} /> Comprar
        </button>
        <button
          type="button"
          onClick={() => selecao.limpar()}
          aria-label="Limpar seleção"
          className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

// ── Caixas de seleção ─────────────────────────────────────────
// Mesmo desenho e mesma mecânica de /produtos: pastilha redonda, alvo de clique
// de 32px sobre um desenho de 16px, shift-clique marcando intervalo, e cada
// caixa assinando só o próprio id.

function Check({
  checked, indeterminate, onChange, label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (shift: boolean) => void;
  label: string;
}) {
  const shiftRef = useRef(false);
  return (
    <span className="relative inline-flex">
      <Checkbox
        checked={checked}
        indeterminate={indeterminate}
        onChange={() => onChange(shiftRef.current)}
        onClick={(e) => { shiftRef.current = e.shiftKey; e.stopPropagation(); }}
        aria-label={label}
      />
      <span
        aria-hidden
        className="absolute -inset-2 cursor-pointer"
        onClick={(e) => { e.stopPropagation(); onChange(e.shiftKey); }}
      />
    </span>
  );
}

function CheckLinha({
  id, idx, onToggle, label,
}: {
  id: string;
  idx: number;
  onToggle: (id: string, idx: number, shift: boolean) => void;
  label: string;
}) {
  const marcado = useSelecionado(id);
  return <Check checked={marcado} onChange={(shift) => onToggle(id, idx, shift)} label={label} />;
}

function CheckDaPagina({ ids }: { ids: string[] }) {
  const selecao = useSelecao();
  const marcados = useQtdDaPagina(ids);
  const todos = ids.length > 0 && marcados === ids.length;
  return (
    <Check
      checked={todos}
      indeterminate={!todos && marcados > 0}
      onChange={() => selecao.alternarVarios(ids, !todos)}
      label="Selecionar todos desta página"
    />
  );
}

// ── Checkbox de menu (Mais filtros / Exibição) ─────────────────

function CheckRow({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-sm text-ink transition-colors hover:bg-surface-2">
      <Checkbox checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

/** Botão de densidade — par único: "Densa" (sem miniatura) e "Média". */
function DensityBtn({
  active, onClick, icon, children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-1.5 text-xs font-medium transition-colors",
        active ? "border-brand/40 bg-brand-soft text-brand-strong" : "border-line text-ink-2 hover:bg-surface-2",
      )}
    >
      {icon} {children}
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
            {[10, 25, 50, 100, 200].map((n) => (
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

/**
 * Cada estratégia mede uma coisa diferente, então cada uma desenha a sua:
 *  · MINIMO       → folga sobre o piso  (escala 0…2× mínimo, traço no meio);
 *  · MINIMO_IDEAL → medidor dois-saldos (escala 0…ideal, traço no mínimo,
 *                   sobra em âmbar quando passa do ideal);
 *  · ROTATIVIDADE → régua de dias       (escala 0…1,5× meta, traço na meta) —
 *                   ali a unidade de decisão é dia, não caixa.
 * Compartilham a mesma moldura (largura, altura da barra, tipografia) para a
 * coluna não "pular" quando a empresa troca de estratégia.
 */

/** Moldura comum: número em destaque, barra, linha de apoio. */
function CelulaBase({
  valor,
  unidade,
  extra,
  children,
  rodape,
}: {
  valor: string;
  unidade: string;
  /** Canto superior direito — cobertura, excesso, etc. */
  extra?: React.ReactNode;
  /** A barra da estratégia. */
  children: React.ReactNode;
  rodape: React.ReactNode;
}) {
  return (
    <div className="flex w-40 max-w-full flex-col gap-1">
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-sm font-semibold tabular-nums text-ink">{valor}</span>
        <span className="text-[11px] text-muted">{unidade}</span>
        {extra && <span className="ml-auto text-[11px] font-medium tabular-nums">{extra}</span>}
      </div>
      {children}
      {rodape}
    </div>
  );
}

/** Trilho com preenchimento e um traço opcional de limiar. */
function Trilho({
  fill,
  cor,
  marca,
  marcaTitle,
  tracejado = false,
  excesso = 0,
}: {
  fill: number;
  cor: string;
  /** Posição (0–100) do traço de limiar — mínimo ou meta. */
  marca?: number | null;
  marcaTitle?: string;
  /** Sem dado suficiente: trilho vazio, contorno tracejado. */
  tracejado?: boolean;
  /** Largura (0–100) do bloco de sobra à direita, fora do trilho principal. */
  excesso?: number;
}) {
  return (
    <div className="flex items-center gap-px">
      <div
        className={cn(
          "relative h-2 flex-1 overflow-hidden rounded-full bg-line ring-1 ring-inset ring-line",
          tracejado && "bg-transparent ring-0 border border-dashed border-line",
        )}
      >
        {!tracejado && (
          <div className={cn("h-full rounded-full transition-all", cor)} style={{ width: `${fill}%` }} />
        )}
        {marca != null && (
          <span
            aria-hidden
            title={marcaTitle}
            className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink/60"
            style={{ left: `${marca}%` }}
          />
        )}
      </div>
      {excesso > 0 && (
        <div
          aria-hidden
          title="Acima do ideal"
          className="h-2 shrink-0 rounded-full bg-accent/50"
          style={{ width: `${excesso}%` }}
        />
      )}
    </div>
  );
}

const clampPct = (v: number) => Math.min(100, Math.max(0, v));

/** MINIMO — o piso é limiar, não meta: o que interessa é a folga sobre ele. */
function CelulaMinimo({ s }: { s: SaldoRow }) {
  const policy = usePolicy();
  const m = STATUS_META[statusOf(s, policy)];
  const { estoqueFechado: f, estoqueMinimo: min } = s;
  const un = closedUnitLabel(s);

  if (min <= 0) {
    return (
      <CelulaBase valor={fmt(f)} unidade={un} rodape={<SemMeta productId={s.productId} />}>
        <Trilho fill={f > 0 ? 100 : 0} cor={m.bar} />
      </CelulaBase>
    );
  }

  // Escala 0…2× mínimo: o traço cai sempre no meio e a folga fica visível.
  const falta = min - f;
  return (
    <CelulaBase valor={fmt(f)} unidade={un} rodape={
      <span className={cn("text-[10px] tabular-nums", falta > 0 ? "text-danger" : "text-faint")}>
        mín {fmt(min)} · {falta > 0 ? `faltam ${fmt(falta)}` : `${fmt(-falta)} acima`}
      </span>
    }>
      <Trilho fill={clampPct((f / (min * 2)) * 100)} cor={m.bar} marca={50} marcaTitle="Estoque mínimo" />
    </CelulaBase>
  );
}

/** MINIMO_IDEAL — medidor dois-saldos: piso marcado, ideal como fim do trilho. */
function CelulaMinimoIdeal({ s }: { s: SaldoRow }) {
  const policy = usePolicy();
  const m = STATUS_META[statusOf(s, policy)];
  const { estoqueFechado: f, estoqueIdeal: ideal, estoqueMinimo: min } = s;

  // Sem ideal definido, a régua que sobra é o piso — cai no desenho do mínimo.
  if (ideal <= 0) return <CelulaMinimo s={s} />;

  const sobra = Math.max(0, f - ideal);
  return (
    <CelulaBase
      valor={fmt(f)}
      unidade={closedUnitLabel(s)}
      extra={sobra > 0 ? <span className="text-accent">+{fmt(sobra)}</span> : undefined}
      rodape={
        <div className="flex justify-between text-[10px] tabular-nums text-faint">
          <span>mín {fmt(min)}</span>
          <span>ideal {fmt(ideal)}</span>
        </div>
      }
    >
      <Trilho
        fill={clampPct((f / ideal) * 100)}
        cor={m.bar}
        marca={min > 0 ? Math.min(100, (min / ideal) * 100) : null}
        marcaTitle="Estoque mínimo"
        // Sobra proporcional, teto de 30% da largura — só sinaliza o encalhe.
        excesso={sobra > 0 ? Math.min(30, (sobra / ideal) * 100) : 0}
      />
    </CelulaBase>
  );
}

/** ROTATIVIDADE — a decisão é em dias: dia vira o número em destaque. */
function CelulaGiro({ s }: { s: SaldoRow }) {
  const policy = usePolicy();
  const m = STATUS_META[statusOf(s, policy)];
  const { estoqueFechado: f } = s;
  const un = closedUnitLabel(s);
  const qtd = (
    <span className="text-[11px] tabular-nums text-muted">
      {fmt(f)} {un}
    </span>
  );

  // Produto recém-cadastrado: média de 3 dias não descreve nada. Informa, não alarma.
  if (statusOf(s, policy) === "aprendendo") {
    const faltam = Math.max(1, APRENDIZADO_DIAS - diasHistorico(s));
    return (
      <CelulaBase valor={fmt(f)} unidade={un} rodape={
        <span className="inline-flex items-center gap-1 text-[10px] text-faint" title={MSG_APRENDIZADO}>
          <Lightbulb size={10} /> aprendendo · faltam {faltam} d
        </span>
      }>
        <Trilho fill={0} cor={m.bar} tracejado />
      </CelulaBase>
    );
  }

  const cob = diasCobertura(s, policy);
  if (cob == null) {
    return (
      <CelulaBase valor={fmt(f)} unidade={un} rodape={
        <span className="text-[10px] tabular-nums text-faint">sem venda em {policy.periodoMediaDias} d</span>
      }>
        <Trilho fill={0} cor={m.bar} />
      </CelulaBase>
    );
  }

  // Escala 0…1,5× meta: o traço da meta fica a 2/3 e ainda sobra trilho p/ ver excesso.
  const meta = policy.diasCobertura;
  return (
    <CelulaBase
      valor={String(cob)}
      unidade={cob === 1 ? "dia" : "dias"}
      extra={qtd}
      rodape={
        <div className="flex justify-between text-[10px] tabular-nums text-faint">
          <span>{fmt1(mediaDia(s, policy))}/dia</span>
          <span>meta {meta} d</span>
        </div>
      }
    >
      <Trilho
        fill={clampPct((cob / (meta * 1.5)) * 100)}
        cor={m.bar}
        marca={100 / 1.5}
        marcaTitle={`Cobertura desejada: ${meta} dias`}
      />
    </CelulaBase>
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
  if (policy.usaGiro) return <CelulaGiro s={s} />;
  if (policy.usaIdeal) return <CelulaMinimoIdeal s={s} />;
  return <CelulaMinimo s={s} />;
}

function SemMeta({ productId }: { productId: string }) {
  return (
    <Link
      href={`/produtos/${productId}/editar`}
      title="Definir estoque mínimo no cadastro do produto"
      onClick={(e) => e.stopPropagation()}
      className="text-[10px] text-faint underline-offset-2 hover:text-ink hover:underline"
    >
      sem meta definida
    </Link>
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
 * para o pedido em Pedidos. Recomendações de compra vivem na Reposição
 * Inteligente (/cotacoes/reposicao-inteligente) — nunca aqui.
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
      href={`/pedidos?q=${encodeURIComponent(s.reposNumero)}`}
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
  denso = false,
}: {
  s: SaldoRow;
  onPendencias?: () => void;
  /** Quando presente, o nome vira botão focável — acesso por teclado nas linhas da tabela. */
  onOpen?: () => void;
  /** Densidade "Densa": sem miniatura, para caber mais linha na tela. */
  denso?: boolean;
}) {
  const st = statusOf(s, usePolicy());
  const cadGaps = dataGaps(s).filter((g) => g !== "local"); // custo, fornecedor
  return (
    <div className="flex min-w-0 items-center gap-3">
      {!denso && <Thumb url={s.imagemUrl} />}
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
      {/* `uppercase` explícito: o UA stylesheet zera text-transform em <button>,
          então sem isto só as colunas ordenáveis saíam em caixa baixa. */}
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 uppercase tracking-wide transition-colors hover:text-ink",
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
  aprendendo:  { label: "Aprendendo o giro",  text: "text-faint", dot: "bg-faint"  },
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
  if (st === "aprendendo")  return MSG_APRENDIZADO;
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
    // Sem histórico bastante, sugerir quantidade é chutar — melhor calar,
    // salvo se a cobertura já está crítica (aí a compra não pode esperar).
    if (m <= 0 || st === "aprendendo") return null;
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
      {copiado ? <CheckIcon size={12} className="text-ok" /> : <Copy size={12} className="text-faint" />}
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
          sempre a cobertura, que faz sentido em qualquer modelo. As colunas
          contam a partir da própria estratégia — na rotatividade são quatro
          (disponível, média, desejada, cobertura), não três. */}
      <div
        className={cn(
          "grid divide-x divide-line rounded-xl border border-line bg-surface",
          // 1 fixo (disponível) + 1 fixo (cobertura) + as metas da régua ativa
          2 + (policy.usaMinimo ? 1 : 0) + (policy.usaIdeal ? 1 : 0) + (policy.usaGiro ? 2 : 0) === 4
            ? "grid-cols-4"
            : "grid-cols-3",
        )}
      >
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
