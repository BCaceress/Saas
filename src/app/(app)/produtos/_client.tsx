"use client";

import { Fragment, useMemo, useState, useTransition, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus, Tag, FolderTree, Warehouse, Truck, Upload, Search, Settings2,
  Pencil, PackageOpen, Wine, ChevronDown, Boxes,
  MoreVertical, EyeOff, Eye, X,
  Barcode, Hash, ChevronLeft, ChevronRight,
  ArrowUp, ArrowDown, ChevronsUpDown, Globe, SlidersHorizontal, Columns3,
  Download, Rows2, Rows3, LayoutGrid, FilterX, Percent, BottleWine, Printer, ImagePlus,
  TextCursorInput, Box, Refrigerator, Snowflake, Star, Trash2, Check as CheckIcon,
  TrendingUp, Clock, Users, FileSpreadsheet, ChevronUp,
} from "lucide-react";
import { cn, brl, margem, maskMoney, moneyToMask, parseMoney } from "@/lib/utils";
import { POLICY_PADRAO, type EstoquePolicy } from "@/lib/estoque-estrategia";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Select } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";
import {
  ProductSidePanel, stockLevel, TIPO_LABEL, TIPO_ICON, STOCK_COLOR, STOCK_TITLE, STOCK_TEXT,
} from "@/components/app/product-side-panel";
import { BrandSheet, CategorySheet, StorageSheet, SupplierSheet } from "./_sheets/sidepanels";
import { CsvSheet } from "./_sheets/csv-sheet";
import { EtiquetasSheet } from "./_sheets/etiquetas-sheet";
import { ImagensSheet, type ProdutoImagem } from "./_sheets/imagens-sheet";
import { LoteSheet } from "./_sheets/lote-sheet";
import { NomesSheet } from "./_sheets/nomes-sheet";
import { archiveProduct, getGerenciarExtras } from "./actions";
import {
  apagarVisao, linhasParaExport, linhasSelecionadas,
  salvarVisao, selecionarIdsDoFiltro, setPrecoVenda,
} from "./list-actions";
import { consultaParaParams, contarFiltros, soFiltro, STATUS_PADRAO } from "./_url";
import { useOpcoes } from "./_opcoes";
import { baixarXlsx } from "./_export";
import {
  SEM_MARCA, SEM_TAG,
  type ProductRow, type ProductPackagingItem, type ProdutoConsulta, type ProdutoFlags,
  type ProdutoGiro, type ProdutoSortDir, type ProdutoSortField,
  type ProdutosPagina, type ProdutoVisao,
} from "./_types";
import type { GerenciarExtras } from "./_data";

type SheetKind = null | "brand" | "category" | "storage" | "supplier" | "csv" | "imagens" | "lote" | "nomes";

/**
 * Teto de produtos por rodada de busca de imagem. A cota da base de códigos é
 * finita: melhor rodar em tandas e ver o resultado do que queimar tudo de uma vez.
 */
const IMAGENS_POR_RODADA = 100;

const POR_PAGINA = [25, 50, 100, 200];

/** Quantidade de estoque exibível (null = produto sem controle de estoque). */
function stockQty(p: ProductRow): number | null {
  if (p.disponibilidadeDerivada !== null) return p.disponibilidadeDerivada;
  const semControle =
    p.tipo === "PERSONALIZADO" ||
    (p.tipo === "INSUMO" && p.estoque.minimo <= 0 && p.estoque.ideal <= 0);
  if (semControle) return null;
  return p.estoque.fechado;
}

/** Cor da margem por faixa de saúde (negativa/magra/saudável). */
function margemColor(m: number | null): string {
  if (m == null) return "text-faint";
  if (m < 0) return "text-danger";
  if (m < 15) return "text-warn";
  return "text-ok";
}

function principalFornecedor(p: ProductRow) {
  return p.fornecedores.find((f) => f.isPrincipal) ?? p.fornecedores[0];
}

/**
 * Ícone/cor do local seguem o tipo de armazenagem escolhido no Estoque —
 * mesma tabela usada em /estoque/saldos e em Configurações → Lojas.
 */
type StorageTipo = "AMBIENTE" | "REFRIGERADO" | "CONGELADO";
const STORAGE_TIPO_ICON: Record<StorageTipo, React.ElementType> = {
  AMBIENTE: Box,
  REFRIGERADO: Refrigerator,
  CONGELADO: Snowflake,
};
const STORAGE_TIPO_COLOR: Record<StorageTipo, string> = {
  AMBIENTE: "text-brand",
  REFRIGERADO: "text-ok",
  CONGELADO: "text-blue-500",
};

type LocalEmUso = { nome: string; tipo: StorageTipo | null };

/** Locais de armazenagem em uso (loja/local ativos, sem repetir nome). */
function locaisEmUso(p: ProductRow): LocalEmUso[] {
  const porNome = new Map<string, LocalEmUso>();
  for (const l of p.locais) {
    if (!l.siteAtivo || l.locationAtivo === false) continue;
    if (!l.locationNome || porNome.has(l.locationNome)) continue;
    porNome.set(l.locationNome, { nome: l.locationNome, tipo: l.locationTipo ?? null });
  }
  return [...porNome.values()];
}

/**
 * Indicador de garrafa aberta: sinal "+" fora do badge, garrafa dentro do chip
 * âmbar. Sem `title` (evita o tooltip preto nativo do navegador) — o estado já
 * é óbvio pelo ícone; detalhe fica no hint de estoque por loja.
 */
function AbertaBadge({ size = 16 }: { size?: number }) {
  return (
    <span className="ml-0.5 inline-flex items-center gap-1 text-warn">
      <span className="text-[12px] font-bold leading-none">+</span>
      <span className="inline-flex items-center rounded-full bg-warn/10 p-1">
        <BottleWine size={size} className="shrink-0" aria-label="Tem garrafa aberta" />
      </span>
    </span>
  );
}

// ── Colunas configuráveis ────────────────────────────────────────────────────
type ColKey =
  | "marca" | "tipo" | "categoria" | "local" | "margem" | "fornecedor" | "estoque"
  | "vendas" | "parado";
const COL_ORDER: ColKey[] = [
  "marca", "tipo", "categoria", "local", "margem", "fornecedor", "estoque", "vendas", "parado",
];
const COL_LABEL: Record<ColKey, string> = {
  marca: "Marca", tipo: "Tipo", categoria: "Categoria", local: "Local de estoque",
  margem: "Margem", fornecedor: "Fornecedor", estoque: "Estoque",
  vendas: "Vendas 30d", parado: "Parado há",
};
const DEFAULT_COLS: Record<ColKey, boolean> = {
  marca: false, tipo: true, categoria: true, local: false,
  margem: true, fornecedor: true, estoque: true, vendas: false, parado: false,
};
/** compact = tabela · denso = tabela sem foto e sem respiro · cozy = grade de cards. */
type Density = "cozy" | "compact" | "denso";

// ── Informativos (badges auxiliares, independentes de coluna) ───────────────
type InfoKey = "restricao" | "sku";
const INFO_ORDER: InfoKey[] = ["restricao", "sku"];
const INFO_LABEL: Record<InfoKey, string> = { restricao: "Restrição +18", sku: "SKU" };
const DEFAULT_INFO: Record<InfoKey, boolean> = { restricao: true, sku: true };

const FLAG_LABEL: Record<keyof ProdutoFlags, string> = {
  semPreco: "Sem preço", semImagem: "Sem imagem", semEan: "Sem código de barras",
  semFiscal: "Sem perfil fiscal", online: "Vende online", maiorIdade: "Restrição +18",
};

const TIPO_FILTRO_LABEL: Record<string, string> = {
  SIMPLES: "Simples", COMBO: "Combo", PERSONALIZADO: "Receita", INSUMO: "Insumo",
};
const STATUS_LABEL: Record<string, string> = { ativos: "Ativos", inativos: "Inativos" };

// ── Persistência leve de preferências de exibição ────────────────────────────
function readLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

/** Lista de colunas ligadas, no formato que vai (e volta) da URL. */
function colsDaString(s: string | null): Record<ColKey, boolean> | null {
  if (s == null) return null;
  const ligadas = new Set(s.split(",").filter(Boolean));
  return Object.fromEntries(COL_ORDER.map((k) => [k, ligadas.has(k)])) as Record<ColKey, boolean>;
}

export function ProdutosClient(props: {
  pagina: ProdutosPagina;
  consultaInicial: ProdutoConsulta;
  visoesIniciais: ProdutoVisao[];
  initialFornecedorNome?: string;
  /** Estratégia de estoque — define as colunas do importador de CSV. */
  policy?: EstoquePolicy;
}) {
  const {
    pagina, consultaInicial, visoesIniciais,
    initialFornecedorNome, policy = POLICY_PADRAO,
  } = props;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [navegando, start] = useTransition();
  const [ocupado, setOcupado] = useState(false);

  // Vêm do layout: não se refazem a cada mudança de filtro.
  const { categoryOpts, subOpts, brandOpts, siteOpts, tagOpts } = useOpcoes();
  const { rows, giro, total, totalGeral } = pagina;

  const [sheet, setSheet] = useState<SheetKind>(null);
  /** Fila da busca de imagens — congelada na abertura do painel. */
  const [imagensAlvo, setImagensAlvo] = useState<ProdutoImagem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductRow | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  // Dados dos sheets de "Gerenciar" (categorias/armazenagem/fornecedores) só
  // são buscados quando o usuário de fato abre o menu — não no load da página.
  const [extras, setExtras] = useState<GerenciarExtras | null>(null);
  const extrasRequested = useRef(false);
  function ensureExtras() {
    if (extrasRequested.current) return;
    extrasRequested.current = true;
    getGerenciarExtras().then(setExtras);
  }

  // ── Consulta (filtro + ordem + página) ──
  // O estado local responde ao teclado na hora; a URL — e com ela o servidor —
  // é atualizada em seguida, com debounce. Fonte de verdade dos DADOS é sempre
  // o que o RSC devolveu; daí `rows` vir de props, não de estado.
  const [consulta, setConsulta] = useState<ProdutoConsulta>(consultaInicial);
  const chaveServidor = consultaParaParams(consultaInicial).toString();
  const [chaveAdotada, setChaveAdotada] = useState(chaveServidor);

  // Voltar/avançar no navegador (ou refresh do RSC) manda: adota o que veio.
  // Ajuste durante o render, não em efeito — evita o flash da tela com o filtro
  // antigo antes do efeito rodar.
  if (chaveServidor !== chaveAdotada) {
    setChaveAdotada(chaveServidor);
    setConsulta(consultaInicial);
  }

  // Preferências de exibição: URL manda (link compartilhável), navegador é o
  // padrão de quem abre /produtos sem parâmetro nenhum.
  const [cols, setCols] = useState<Record<ColKey, boolean>>(
    () => colsDaString(searchParams.get("cols")) ?? readLS("produtos:cols", DEFAULT_COLS),
  );
  const [info, setInfo] = useState<Record<InfoKey, boolean>>(() => {
    const daUrl = searchParams.get("info");
    if (daUrl == null) return readLS("produtos:info", DEFAULT_INFO);
    const ligadas = new Set(daUrl.split(",").filter(Boolean));
    return Object.fromEntries(INFO_ORDER.map((k) => [k, ligadas.has(k)])) as Record<InfoKey, boolean>;
  });
  const [density, setDensity] = useState<Density>(
    () => readLS("produtos:ui", { density: "compact" as Density }).density,
  );
  useEffect(() => { try { localStorage.setItem("produtos:cols", JSON.stringify(cols)); } catch {} }, [cols]);
  useEffect(() => { try { localStorage.setItem("produtos:info", JSON.stringify(info)); } catch {} }, [info]);
  useEffect(() => { try { localStorage.setItem("produtos:ui", JSON.stringify({ density })); } catch {} }, [density]);

  /** URL completa da tela: consulta + colunas + informativos. */
  const paramsDaTela = useCallback(
    (c: ProdutoConsulta, cl: Record<ColKey, boolean>, inf: Record<InfoKey, boolean>) => {
      const p = consultaParaParams(c);
      if (c.fornecedorId && initialFornecedorNome) p.set("fornecedorNome", initialFornecedorNome);
      const ligadas = COL_ORDER.filter((k) => cl[k]);
      const padraoCols = COL_ORDER.filter((k) => DEFAULT_COLS[k]);
      if (ligadas.join(",") !== padraoCols.join(",")) p.set("cols", ligadas.join(","));
      const infoLigadas = INFO_ORDER.filter((k) => inf[k]);
      const padraoInfo = INFO_ORDER.filter((k) => DEFAULT_INFO[k]);
      if (infoLigadas.join(",") !== padraoInfo.join(",")) p.set("info", infoLigadas.join(","));
      return p.toString();
    },
    [initialFornecedorNome],
  );

  const alvoUrl = paramsDaTela(consulta, cols, info);
  const urlAtual = searchParams.toString();

  useEffect(() => {
    if (alvoUrl === urlAtual) return;
    const t = setTimeout(() => {
      start(() => router.replace(alvoUrl ? `/produtos?${alvoUrl}` : "/produtos", { scroll: false }));
    }, 300);
    return () => clearTimeout(t);
  }, [alvoUrl, urlAtual, router]);

  // Próxima página no forno assim que a atual assenta: paginar catálogo é
  // clicar seguido, e o RSC dela já chega pronto.
  useEffect(() => {
    if (alvoUrl !== urlAtual) return;
    const proxima = new URLSearchParams(urlAtual);
    proxima.set("pg", String(consulta.pagina + 1));
    const t = setTimeout(() => router.prefetch(`/produtos?${proxima.toString()}`), 400);
    return () => clearTimeout(t);
  }, [alvoUrl, urlAtual, consulta.pagina, router]);

  // Seleção em lote (atravessa páginas: guarda ids, não linhas).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [etiquetasAlvo, setEtiquetasAlvo] = useState<ProductRow[]>([]);
  const [etiquetasOpen, setEtiquetasOpen] = useState(false);
  const ultimoIdx = useRef<number | null>(null);

  /** Muda a consulta e volta para a página 1 (salvo quando é a própria página). */
  const aplicar = useCallback((patch: Partial<ProdutoConsulta>) => {
    setConsulta((c) => ({ ...c, ...patch, pagina: patch.pagina ?? 1 }));
    if (patch.pagina === undefined) setSelected(new Set());
  }, []);

  const aplicarFlag = useCallback((k: keyof ProdutoFlags, valor?: boolean) => {
    setConsulta((c) => ({
      ...c,
      pagina: 1,
      flags: { ...c.flags, [k]: valor ?? !c.flags[k] },
    }));
    setSelected(new Set());
  }, []);

  function toggleSort(field: ProdutoSortField) {
    setConsulta((c) => ({
      ...c,
      pagina: 1,
      sort: field,
      dir:
        c.sort === field
          ? c.dir === "asc" ? "desc" : "asc"
          : field === "nome" || field === "marca" || field === "tipo" || field === "categoria" || field === "fornecedor"
            ? "asc"
            : "desc",
    }));
  }

  const filtrosAtivos = contarFiltros(consulta);

  const limparFiltros = useCallback(() => {
    setConsulta((c) => ({
      ...c,
      q: "", tipo: "", sub: "", marca: "", fornecedorId: "", siteId: "", tag: "",
      status: STATUS_PADRAO,
      flags: {
        semPreco: false, semImagem: false, semEan: false, semFiscal: false,
        online: false, maiorIdade: false,
      },
      pagina: 1,
    }));
    setSelected(new Set());
  }, []);

  function novo(tipo: "simples" | "insumo" | "combo" | "personalizado") { router.push(`/produtos/novo/${tipo}`); }
  function editar(p: ProductRow) { router.push(`/produtos/${p.id}/editar`); }

  /** Inativar/ativar com volta atrás: a ação é reversível, o modal seria atrito. */
  function toggleInativo(p: ProductRow) {
    const alvo = !p.ativo;
    setOcupado(true);
    archiveProduct(p.id, alvo)
      .then(() => {
        router.refresh();
        toast.success(
          alvo ? `${p.nome} ativado` : `${p.nome} inativado`,
          undefined,
          {
            rotulo: "Desfazer",
            onClick: async () => {
              await archiveProduct(p.id, !alvo);
              router.refresh();
            },
          },
        );
      })
      .catch((e) => toast.error("Não deu para mudar a situação", e instanceof Error ? e.message : undefined))
      .finally(() => setOcupado(false));
  }

  // ── Seleção ──
  const pageIds = rows.map((p) => p.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const somePageSelected = pageIds.some((id) => selected.has(id));

  function toggleRow(id: string, idx: number, shift = false) {
    setSelected((prev) => {
      const next = new Set(prev);
      // Shift-clique marca o intervalo desde a última linha tocada — é como o
      // operador seleciona "essa prateleira inteira" sem 40 cliques.
      if (shift && ultimoIdx.current !== null) {
        const [ini, fim] = [ultimoIdx.current, idx].sort((a, b) => a - b);
        const marcar = !prev.has(id);
        for (let i = ini; i <= fim; i++) {
          const alvo = rows[i]?.id;
          if (!alvo) continue;
          if (marcar) next.add(alvo); else next.delete(alvo);
        }
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    ultimoIdx.current = idx;
  }

  function toggleAllPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
    ultimoIdx.current = null;
  }

  async function selecionarTudoDoFiltro() {
    setOcupado(true);
    try {
      const ids = await selecionarIdsDoFiltro(soFiltro(consulta));
      setSelected(new Set(ids));
      toast.info(`${ids.length} produtos selecionados`, "Vale para todas as páginas do filtro.");
    } catch (e) {
      toast.error("Não deu para selecionar tudo", e instanceof Error ? e.message : undefined);
    } finally {
      setOcupado(false);
    }
  }

  /** Linhas completas dos selecionados — a seleção pode estar fora da página. */
  async function linhasDaSelecao(): Promise<ProductRow[]> {
    const ids = [...selected];
    const naPagina = new Map(rows.map((r) => [r.id, r]));
    if (ids.every((id) => naPagina.has(id))) return ids.map((id) => naPagina.get(id)!);
    return linhasSelecionadas(ids);
  }

  async function comSelecao(fn: (linhas: ProductRow[]) => void) {
    setOcupado(true);
    try {
      fn(await linhasDaSelecao());
    } catch (e) {
      toast.error("Não deu para carregar a seleção", e instanceof Error ? e.message : undefined);
    } finally {
      setOcupado(false);
    }
  }

  // ── Exportação ──
  /** Sem seleção, exporta o filtro inteiro (não só a página na tela). */
  async function exportar(formato: "csv" | "xlsx") {
    setOcupado(true);
    try {
      const { linhas, giroExport } = selected.size
        ? { linhas: await linhasDaSelecao(), giroExport: giro }
        : await linhasParaExport(soFiltro(consulta), consulta.sort, consulta.dir).then((r) => ({
            linhas: r.rows,
            giroExport: r.giro,
          }));
      const tabela = montarTabela(linhas, giroExport, cols, info);
      if (formato === "csv") baixarCsv(tabela);
      else {
        baixarXlsx({
          nomeArquivo: `produtos-${new Date().toISOString().slice(0, 10)}.xlsx`,
          aba: "Produtos",
          cabecalho: tabela.cabecalho,
          linhas: tabela.linhas,
        });
      }
    } catch (e) {
      toast.error("Não deu para exportar", e instanceof Error ? e.message : undefined);
    } finally {
      setOcupado(false);
    }
  }

  // ── Imagens por código de barras ──
  function abrirImagens(lista: ProductRow[]) {
    setImagensAlvo(
      lista.slice(0, IMAGENS_POR_RODADA).map<ProdutoImagem>((p) => ({
        id: p.id,
        nome: p.nome,
        sku: p.sku,
        ean: p.ean,
        imagemUrl: p.imagemUrl,
      })),
    );
    setSheet("imagens");
  }

  // ── Edição em lote (categoria, marca, preço, fornecedores) ──
  /** Fila congelada na abertura do painel — mesma ideia da busca de imagens. */
  const [loteAlvo, setLoteAlvo] = useState<{ id: string; nome: string; sku: string; tipo: string }[]>([]);
  function abrirLote(lista: ProductRow[]) {
    setLoteAlvo(lista.map((p) => ({ id: p.id, nome: p.nome, sku: p.sku, tipo: p.tipo })));
    ensureExtras();
    setSheet("lote");
  }

  // ── Alterar nomes em massa ──
  const [nomesAlvo, setNomesAlvo] = useState<{ id: string; nome: string; sku: string }[]>([]);
  function abrirNomes(lista: ProductRow[]) {
    setNomesAlvo(lista.map((p) => ({ id: p.id, nome: p.nome, sku: p.sku })));
    setSheet("nomes");
  }

  // ── Visões salvas ──
  const [visoes, setVisoes] = useState<ProdutoVisao[]>(visoesIniciais);
  const [salvandoVisao, setSalvandoVisao] = useState(false);

  function guardarVisao(daLoja: boolean) {
    const nome = window.prompt(
      daLoja ? "Nome da visão da loja (todo mundo vê)" : "Nome da visão (ex.: Bebidas sem preço)",
    )?.trim();
    if (!nome) return;
    setSalvandoVisao(true);
    salvarVisao({ nome, params: alvoUrl, daLoja })
      .then((lista) => {
        setVisoes(lista);
        toast.success(
          `Visão "${nome}" salva`,
          daLoja ? "Visível para toda a equipe." : "Aparece no menu Visões, em qualquer máquina.",
        );
      })
      .catch((e) => toast.error("Não deu para salvar a visão", e instanceof Error ? e.message : undefined))
      .finally(() => setSalvandoVisao(false));
  }

  function removerVisao(v: ProdutoVisao) {
    apagarVisao(v.id)
      .then(setVisoes)
      .catch((e) => toast.error("Não deu para apagar", e instanceof Error ? e.message : undefined));
  }

  function aplicarVisao(v: ProdutoVisao) {
    start(() => router.replace(v.params ? `/produtos?${v.params}` : "/produtos", { scroll: false }));
    const c = colsDaString(new URLSearchParams(v.params).get("cols"));
    if (c) setCols(c);
    setSelected(new Set());
  }

  const carregando = navegando || ocupado;
  const temProdutos = totalGeral > 0;
  /** Qualquer camada modal na tela (slide-over, sidepanel do produto, visualizador). */
  const painelAberto = sheet !== null || etiquetasOpen || !!selectedProduct || !!imageUrl;
  const denso = density === "denso";
  const cozy = density === "cozy";
  const cellPad = denso ? "py-1" : "py-1.5";

  const totalPaginas = Math.max(1, Math.ceil(total / consulta.porPagina));
  const paginaAtual = Math.min(consulta.pagina, totalPaginas);
  const inicio = (paginaAtual - 1) * consulta.porPagina;

  // Chips: o operador precisa ver O QUÊ está filtrando, não só quantos filtros.
  const chips = useMemo(() => {
    const lista: { key: string; label: string; limpar: () => void }[] = [];
    if (consulta.q) lista.push({ key: "q", label: `"${consulta.q}"`, limpar: () => aplicar({ q: "" }) });
    if (consulta.tipo) {
      lista.push({
        key: "tipo",
        label: TIPO_FILTRO_LABEL[consulta.tipo] ?? consulta.tipo,
        limpar: () => aplicar({ tipo: "" }),
      });
    }
    if (consulta.sub) {
      const nome = consulta.sub.startsWith("cat:")
        ? categoryOpts.find((c) => c.id === consulta.sub.slice(4))?.nome
        : subOpts.find((s) => s.id === consulta.sub)?.nome;
      lista.push({ key: "sub", label: nome ?? "Categoria", limpar: () => aplicar({ sub: "" }) });
    }
    if (consulta.marca) {
      const nome = consulta.marca === SEM_MARCA
        ? "Sem marca"
        : brandOpts.find((b) => b.id === consulta.marca)?.nome ?? "Marca";
      lista.push({ key: "marca", label: nome, limpar: () => aplicar({ marca: "" }) });
    }
    if (consulta.fornecedorId) {
      lista.push({
        key: "forn",
        label: initialFornecedorNome || "Fornecedor",
        limpar: () => aplicar({ fornecedorId: "" }),
      });
    }
    if (consulta.siteId) {
      lista.push({
        key: "loja",
        label: siteOpts.find((s) => s.id === consulta.siteId)?.nome ?? "Loja",
        limpar: () => aplicar({ siteId: "" }),
      });
    }
    if (consulta.tag) {
      const nome = consulta.tag === SEM_TAG
        ? "Sem etiqueta"
        : tagOpts.find((t) => t.id === consulta.tag)?.nome ?? "Etiqueta";
      lista.push({ key: "tag", label: nome, limpar: () => aplicar({ tag: "" }) });
    }
    if (consulta.status !== STATUS_PADRAO) {
      lista.push({
        key: "status",
        label: STATUS_LABEL[consulta.status] ?? consulta.status,
        limpar: () => aplicar({ status: STATUS_PADRAO }),
      });
    }
    (Object.keys(FLAG_LABEL) as (keyof ProdutoFlags)[]).forEach((k) => {
      if (consulta.flags[k]) {
        lista.push({ key: k, label: FLAG_LABEL[k], limpar: () => aplicarFlag(k, false) });
      }
    });
    return lista;
  }, [consulta, categoryOpts, subOpts, brandOpts, siteOpts, tagOpts, initialFornecedorNome, aplicar, aplicarFlag]);

  return (
    <>
      <PageHeader
        title="Produtos"
        icon={navIcon("/produtos")}
        innerClassName="max-w-none"
        actions={
          <>
            <Menu
                align="end"
                trigger={
                  <Button variant="ghost" size="sm" className="gap-1.5">
                    <Star size={15} /> Visões
                    {visoes.length > 0 && (
                      <span className="grid h-4 min-w-4 place-items-center rounded-full bg-surface-2 px-1 text-[10px] font-bold text-muted">
                        {visoes.length}
                      </span>
                    )}
                    <ChevronDown size={14} className="-mr-0.5 text-muted" />
                  </Button>
                }
              >
                {visoes.length === 0 && (
                  <p className="px-2.5 py-2 text-xs text-muted">
                    Nenhuma visão salva. Monte um filtro e guarde aqui.
                  </p>
                )}
                {visoes.map((v) => (
                  <div key={v.id} className="flex items-center">
                    <button
                      type="button"
                      onClick={() => aplicarVisao(v)}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-2"
                    >
                      <span className="min-w-0 truncate">{v.nome}</span>
                      {!v.minha && (
                        <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-muted">
                          loja
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => removerVisao(v)}
                      aria-label={`Apagar visão ${v.nome}`}
                      className="mr-1 cursor-pointer rounded-full p-1.5 text-faint transition-colors hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <div className="my-1 h-px bg-line" role="separator" />
                <MenuItem icon={<Plus size={15} />} onClick={() => guardarVisao(false)} disabled={salvandoVisao}>
                  Salvar visão atual
                </MenuItem>
                <MenuItem icon={<Users size={15} />} onClick={() => guardarVisao(true)} disabled={salvandoVisao}>
                  Salvar para a loja
                </MenuItem>
            </Menu>

            <Menu
              align="end"
              trigger={
                <Button
                  variant="secondary"
                  size="sm"
                  className="gap-1.5 border-transparent"
                  onMouseEnter={ensureExtras}
                  onFocus={ensureExtras}
                >
                  <Settings2 size={15} /> Gerenciar
                  <ChevronDown size={14} className="-mr-0.5 text-muted" />
                </Button>
              }
            >
              <MenuItem icon={<Tag size={15} />} onClick={() => setSheet("brand")}>Marcas</MenuItem>
              <MenuItem icon={<FolderTree size={15} />} onClick={() => { ensureExtras(); setSheet("category"); }}>Categorias</MenuItem>
              <MenuItem icon={<Warehouse size={15} />} onClick={() => { ensureExtras(); setSheet("storage"); }}>Armazenagem</MenuItem>
              <MenuItem icon={<Truck size={15} />} onClick={() => { ensureExtras(); setSheet("supplier"); }}>Fornecedores</MenuItem>
              <div className="my-1 h-px bg-line" role="separator" />
              <MenuItem icon={<Upload size={15} />} onClick={() => setSheet("csv")}>Importar CSV</MenuItem>
            </Menu>

            <div className="inline-flex shadow-[var(--shadow-1)] rounded-full">
              <Button size="sm" onClick={() => novo("simples")} className="gap-1.5 rounded-r-none shadow-none">
                <Plus size={15} /> Novo produto
              </Button>
              <Menu
                align="end"
                trigger={
                  <Button size="sm" aria-label="Escolher tipo de produto" className="rounded-l-none border-l border-on-brand/25 px-2 shadow-none">
                    <ChevronDown size={16} />
                  </Button>
                }
              >
                <MenuItem icon={<Wine size={15} />} onClick={() => novo("simples")}>Produto simples</MenuItem>
                <MenuItem icon={<Boxes size={15} />} onClick={() => novo("combo")}>Kit / combo</MenuItem>
                <MenuItem icon={<PackageOpen size={15} />} onClick={() => novo("insumo")}>Insumo</MenuItem>
              </Menu>
            </div>
          </>
        }
      />

      <div className="w-full rounded-[var(--radius-lg)] bg-surface p-3 shadow-[var(--shadow-float)] sm:p-4">
        {temProdutos && (
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-line bg-surface-2 p-2">
            <div className="relative min-w-48 flex-1">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
              <Input
                value={consulta.q}
                onChange={(e) => aplicar({ q: e.target.value })}
                placeholder="Buscar nome, SKU ou código de barras"
                className="h-9 rounded-full border-line bg-surface pl-9"
              />
            </div>
            {cols.tipo && (
              <Select value={consulta.tipo} onChange={(e) => aplicar({ tipo: e.target.value })} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
                <option value="">Todos os tipos</option>
                <option value="SIMPLES">Simples</option>
                <option value="COMBO">Combo</option>
                <option value="PERSONALIZADO">Receita</option>
                <option value="INSUMO">Insumo</option>
              </Select>
            )}
            {cols.categoria && (
              <Select value={consulta.sub} onChange={(e) => aplicar({ sub: e.target.value })} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
                <option value="">Toda categoria</option>
                {/* A categoria é a própria opção (filtra tudo dela); as subcategorias
                    vêm indentadas abaixo. optgroup não serve: rótulo de grupo não
                    é clicável.
                    Negrito na categoria e recuo com espaço inseparável (o navegador
                    engole espaço comum dentro de <option>). */}
                {categoryOpts.map((c) => (
                  <Fragment key={c.id}>
                    <option value={`cat:${c.id}`} className="font-semibold" style={{ fontWeight: 600 }}>
                      {c.nome}
                    </option>
                    {subOpts
                      .filter((s) => s.categoryId === c.id)
                      .map((s) => (
                        <option key={s.id} value={s.id} style={{ fontWeight: 400 }}>
                          {"    "}{s.nome}
                        </option>
                      ))}
                  </Fragment>
                ))}
              </Select>
            )}
            {cols.marca && (
              <Select value={consulta.marca} onChange={(e) => aplicar({ marca: e.target.value })} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
                <option value="">Toda marca</option>
                {brandOpts.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
                <option value={SEM_MARCA}>Sem marca</option>
              </Select>
            )}
            {/* Loja só faz sentido em quem tem mais de uma. */}
            {siteOpts.length > 1 && (
              <Select value={consulta.siteId} onChange={(e) => aplicar({ siteId: e.target.value })} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
                <option value="">Todas as lojas</option>
                {siteOpts.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </Select>
            )}
            {tagOpts.length > 0 && (
              <Select value={consulta.tag} onChange={(e) => aplicar({ tag: e.target.value })} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
                <option value="">Toda etiqueta</option>
                {tagOpts.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                <option value={SEM_TAG}>Sem etiqueta</option>
              </Select>
            )}
            <Select value={consulta.status} onChange={(e) => aplicar({ status: e.target.value })} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
              <option value="ativos">Ativos</option>
              <option value="inativos">Inativos</option>
            </Select>

            {/* Mais filtros (booleanos de higiene/negócio) */}
            <Menu
              align="end"
              trigger={
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                    Object.values(consulta.flags).some(Boolean)
                      ? "border-brand/40 bg-brand-soft text-brand-strong"
                      : "border-line bg-surface text-ink-2 hover:bg-surface-2",
                  )}
                >
                  <SlidersHorizontal size={14} /> Mais filtros
                  {Object.values(consulta.flags).filter(Boolean).length > 0 && (
                    <span className="grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold text-on-brand">
                      {Object.values(consulta.flags).filter(Boolean).length}
                    </span>
                  )}
                </button>
              }
            >
              <div className="px-1 py-0.5">
                {(Object.keys(FLAG_LABEL) as (keyof ProdutoFlags)[]).map((k) => (
                  <CheckRow
                    key={k}
                    checked={consulta.flags[k]}
                    label={FLAG_LABEL[k]}
                    onChange={() => aplicarFlag(k)}
                  />
                ))}
              </div>
            </Menu>

            {/* Colunas + densidade */}
            <Menu
              align="end"
              trigger={
                <button
                  type="button"
                  aria-label="Colunas e densidade"
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
                    if (cols[k]) {
                      if (k === "tipo") aplicar({ tipo: "" });
                      if (k === "categoria") aplicar({ sub: "" });
                      if (k === "marca") aplicar({ marca: "" });
                    }
                  }}
                />
              ))}
              <div className="my-1 h-px bg-line" role="separator" />
              <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">Informativos</p>
              {INFO_ORDER.map((k) => (
                <CheckRow
                  key={k}
                  checked={info[k]}
                  label={INFO_LABEL[k]}
                  onChange={() => setInfo((c) => ({ ...c, [k]: !c[k] }))}
                />
              ))}
              <div className="my-1 h-px bg-line" role="separator" />
              <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">Densidade</p>
              <div className="flex gap-1 px-1.5 pb-1">
                <DensityBtn active={density === "denso"} onClick={() => setDensity("denso")} icon={<Rows3 size={14} />}>Densa</DensityBtn>
                <DensityBtn active={density === "compact"} onClick={() => setDensity("compact")} icon={<Rows2 size={14} />}>Média</DensityBtn>
                <DensityBtn active={density === "cozy"} onClick={() => setDensity("cozy")} icon={<LayoutGrid size={14} />}>Card</DensityBtn>
              </div>
            </Menu>

            {filtrosAtivos > 0 && (
              <button
                type="button"
                onClick={limparFiltros}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <FilterX size={14} /> Limpar ({filtrosAtivos})
              </button>
            )}
          </div>
        )}

        {/* Chips do que está filtrando agora */}
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <span
                key={c.key}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-strong"
              >
                {c.key === "forn" && <Truck size={12} />}
                {c.label}
                <button
                  type="button"
                  onClick={c.limpar}
                  className="cursor-pointer rounded-full p-0.5 hover:bg-brand/15"
                  aria-label={`Remover filtro ${c.label}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="relative">
        {/* Enquanto a próxima página não chega, linhas-fantasma na altura certa.
            `loading.tsx` só cobre a entrada na rota — trocar filtro é a mesma
            rota, e sem isto a tela só ficava pálida. */}
        {carregando && total > 0 && (
          <div className="absolute inset-x-0 top-4 z-20 rounded-[var(--radius-lg)] bg-surface/85 p-2 backdrop-blur-[1px]">
            <div className="animate-pulse space-y-2" aria-hidden>
              {Array.from({ length: Math.min(rows.length || 8, 12) }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-2">
                  {!denso && <div className="h-9 w-9 shrink-0 rounded-[var(--radius-sm)] bg-surface-2" />}
                  <div className="h-3 flex-1 rounded-full bg-surface-2" />
                  <div className="h-3 w-16 rounded-full bg-surface-2" />
                  <div className="h-3 w-12 rounded-full bg-surface-2" />
                </div>
              ))}
            </div>
            <span className="sr-only" role="status">Carregando produtos…</span>
          </div>
        )}
        <div className={cn("transition-opacity", carregando && "pointer-events-none opacity-40")}>
        {!temProdutos ? (
          <EmptyState onNew={() => novo("simples")} onCsv={() => setSheet("csv")} />
        ) : total === 0 ? (
          <SemResultado chips={chips} onLimparTudo={limparFiltros} />
        ) : cozy ? (
          <>
            {/* ── Cards (densidade confortável — todas as telas) ── */}
            <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((p, idx) => (
                <ProductCard
                  key={p.id}
                  p={p}
                  giro={giro[p.id]}
                  big
                  cols={cols}
                  info={info}
                  selected={selected.has(p.id)}
                  onToggle={(shift) => toggleRow(p.id, idx, shift)}
                  onOpen={() => setSelectedProduct(p)}
                  onImage={p.imagemUrl ? () => setImageUrl(p.imagemUrl) : undefined}
                  onEdit={() => editar(p)}
                  onArchive={() => toggleInativo(p)}
                  onBuscarImagem={() => abrirImagens([p])}
                />
              ))}
            </ul>
          </>
        ) : (
          <>
            {/* ── Tabela (md+) ──
                `table-fixed`: sem ele a largura das colunas dança conforme o
                tamanho dos nomes de cada página, e a tabela "pisca" ao paginar.
                Cabeçalho grudado porque 200 linhas rolam para longe dele. */}
            <div className="mt-4 hidden overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface md:block">
              <table className="w-full table-fixed text-left">
                <thead className="sticky top-0 z-10 border-b border-line bg-surface-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
                  <tr>
                    <th className="w-10 px-3 py-2.5">
                      <Check
                        checked={allPageSelected}
                        indeterminate={!allPageSelected && somePageSelected}
                        onChange={toggleAllPage}
                        label="Selecionar todos desta página"
                      />
                    </th>
                    <SortableTh label="Produto" field="nome" sort={consulta.sort} dir={consulta.dir} onSort={toggleSort} />
                    {cols.marca && <SortableTh label="Marca" field="marca" sort={consulta.sort} dir={consulta.dir} onSort={toggleSort} className="hidden w-36 xl:table-cell" />}
                    {cols.tipo && <SortableTh label="Tipo" field="tipo" sort={consulta.sort} dir={consulta.dir} onSort={toggleSort} className="hidden w-28 lg:table-cell" />}
                    {cols.categoria && <SortableTh label="Categoria" field="categoria" sort={consulta.sort} dir={consulta.dir} onSort={toggleSort} className="hidden w-44 lg:table-cell" />}
                    <SortableTh label="Preço" field="preco" sort={consulta.sort} dir={consulta.dir} onSort={toggleSort} className="w-32" />
                    {cols.local && <th className="hidden w-36 px-4 py-2.5 lg:table-cell">Local</th>}
                    {cols.margem && <SortableTh label="Margem" field="margem" sort={consulta.sort} dir={consulta.dir} onSort={toggleSort} className="hidden w-24 sm:table-cell" />}
                    {cols.fornecedor && <SortableTh label="Fornecedor" field="fornecedor" sort={consulta.sort} dir={consulta.dir} onSort={toggleSort} className="hidden w-40 md:table-cell" />}
                    {cols.estoque && <SortableTh label="Estoque" field="estoque" sort={consulta.sort} dir={consulta.dir} onSort={toggleSort} className="w-28" />}
                    {cols.vendas && <SortableTh label="Vendas 30d" field="vendas" sort={consulta.sort} dir={consulta.dir} onSort={toggleSort} className="hidden w-24 lg:table-cell" />}
                    {cols.parado && <SortableTh label="Parado há" field="parado" sort={consulta.sort} dir={consulta.dir} onSort={toggleSort} className="hidden w-24 lg:table-cell" />}
                    <th className="w-10 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((p, idx) => {
                    const level = stockLevel(p);
                    const principal = principalFornecedor(p);
                    const isSel = selected.has(p.id);
                    return (
                      // A linha inteira continua clicável (o mouse espera isso),
                      // mas quem carrega o papel de botão é o nome do produto —
                      // `role="button"` no <tr> aninha botão dentro de botão e
                      // o leitor de tela não sabe o que anunciar.
                      <tr
                        key={p.id}
                        onClick={() => setSelectedProduct(p)}
                        className={cn(
                          "group relative cursor-pointer transition-colors hover:bg-brand-soft/30 focus-within:bg-brand-soft/30",
                          isSel && "bg-brand-soft/40",
                          !p.ativo && "opacity-50",
                        )}
                      >
                        <td className={cn("px-3", cellPad)} onClick={(e) => e.stopPropagation()}>
                          <Check
                            checked={isSel}
                            onChange={(shift) => toggleRow(p.id, idx, shift)}
                            label={`Selecionar ${p.nome}`}
                          />
                        </td>

                        {/* Produto */}
                        <td className={cn("px-4", cellPad)}>
                          <div className="flex items-center gap-3">
                            {!denso && (
                              <Thumb
                                url={p.imagemUrl}
                                tipo={p.tipo}
                                onClickImage={p.imagemUrl ? () => setImageUrl(p.imagemUrl) : undefined}
                              />
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setSelectedProduct(p); }}
                                  className="min-w-0 cursor-pointer truncate rounded-sm text-left text-[13px] font-semibold leading-snug text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand"
                                >
                                  {p.nome}
                                </button>
                                {p.vendeOnline && (
                                  <Globe size={12} className="shrink-0 text-brand" aria-label="Vende online" />
                                )}
                                {info.restricao && p.restricaoIdade && (
                                  <span className="inline-flex items-center rounded-full border border-danger/30 bg-danger/10 px-1 py-px text-[9px] font-bold text-danger">+18</span>
                                )}
                              </div>
                              {(info.sku || p.ean) && !denso && (
                                <BarcodeCell sku={p.sku} ean={p.ean} packagings={p.packagings} showSku={info.sku} />
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Marca (coluna opcional) */}
                        {cols.marca && (
                          <td className={cn("hidden px-4 xl:table-cell", cellPad)}>
                            {p.marca ? (
                              <span className="text-[12px] text-ink-2">{p.marca}</span>
                            ) : (
                              <span className="text-[11px] text-faint">—</span>
                            )}
                          </td>
                        )}

                        {/* Tipo */}
                        {cols.tipo && (
                          <td className={cn("hidden px-4 lg:table-cell", cellPad)}>
                            <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
                              <span className="text-faint">{TIPO_ICON[p.tipo]}</span>
                              {TIPO_LABEL[p.tipo]}
                            </span>
                          </td>
                        )}

                        {/* Categoria */}
                        {cols.categoria && (
                          <td className={cn("hidden px-4 lg:table-cell", cellPad)}>
                            <div className="text-[13px] font-medium text-ink-2">{p.subcategoriaNome}</div>
                            {!denso && <div className="mt-0.5 text-[11px] text-faint">{p.categoriaNome}</div>}
                          </td>
                        )}

                        {/* Preço — editável na própria linha */}
                        <td className={cn("px-4", cellPad)} onClick={(e) => e.stopPropagation()}>
                          <PriceCell
                            produtoId={p.id}
                            nome={p.nome}
                            tipo={p.tipo}
                            precoVenda={p.precoVenda}
                            custo={p.custo}
                            onSalvo={() => router.refresh()}
                          />
                        </td>

                        {/* Local de estoque */}
                        {cols.local && (
                          <td className={cn("hidden px-4 lg:table-cell", cellPad)}>
                            <LocalCell locais={locaisEmUso(p)} />
                          </td>
                        )}

                        {/* Margem */}
                        {cols.margem && (
                          <td className={cn("hidden px-4 sm:table-cell", cellPad)}>
                            <MargemCell precoVenda={p.precoVenda} custo={p.custo} tipo={p.tipo} />
                          </td>
                        )}

                        {/* Fornecedor */}
                        {cols.fornecedor && (
                          <td className={cn("hidden px-4 md:table-cell", cellPad)}>
                            {principal ? (
                              <span className="text-[12px] text-ink-2 leading-snug">{principal.nome}</span>
                            ) : (
                              <span className="text-[11px] text-faint">—</span>
                            )}
                          </td>
                        )}

                        {/* Estoque */}
                        {cols.estoque && (
                          <td className={cn("px-4", cellPad)}>
                            <StockCell p={p} level={level} />
                          </td>
                        )}

                        {/* Giro */}
                        {cols.vendas && (
                          <td className={cn("hidden px-4 lg:table-cell", cellPad)}>
                            <VendasCell giro={giro[p.id]} tipo={p.tipo} />
                          </td>
                        )}
                        {cols.parado && (
                          <td className={cn("hidden px-4 lg:table-cell", cellPad)}>
                            <ParadoCell giro={giro[p.id]} tipo={p.tipo} />
                          </td>
                        )}

                        {/* Ações */}
                        <td className={cn("px-3", cellPad)} onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end">
                            <Menu
                              align="end"
                              trigger={
                                <button
                                  className="cursor-pointer rounded-[var(--radius-sm)] p-1.5 text-faint transition-colors hover:bg-surface-2 hover:text-ink"
                                  aria-label="Mais ações"
                                >
                                  <MoreVertical size={16} />
                                </button>
                              }
                            >
                              <MenuItem icon={<Pencil size={15} />} onClick={() => editar(p)}>Editar</MenuItem>
                              <MenuItem
                                icon={<ImagePlus size={15} />}
                                onClick={() => abrirImagens([p])}
                                disabled={!p.ean}
                              >
                                Buscar imagem
                              </MenuItem>
                              <div className="my-1 h-px bg-line" role="separator" />
                              <MenuItem
                                icon={p.ativo ? <EyeOff size={15} /> : <Eye size={15} />}
                                onClick={() => toggleInativo(p)}
                              >
                                {p.ativo ? "Inativar" : "Ativar"}
                              </MenuItem>
                            </Menu>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Cards (mobile — densidade compacta) ── */}
            <ul className="mt-4 space-y-2 md:hidden">
              {rows.map((p, idx) => (
                <ProductCard
                  key={p.id}
                  p={p}
                  giro={giro[p.id]}
                  cols={cols}
                  info={info}
                  selected={selected.has(p.id)}
                  onToggle={(shift) => toggleRow(p.id, idx, shift)}
                  onOpen={() => setSelectedProduct(p)}
                  onImage={p.imagemUrl ? () => setImageUrl(p.imagemUrl) : undefined}
                  onEdit={() => editar(p)}
                  onArchive={() => toggleInativo(p)}
                  onBuscarImagem={() => abrirImagens([p])}
                />
              ))}
            </ul>
          </>
        )}
        </div>
        </div>

        {/* ── Paginação ── */}
        {temProdutos && total > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-2 text-xs text-faint">
              <span>
                {inicio + 1}–{Math.min(inicio + consulta.porPagina, total)} de {total}
                {totalGeral !== total ? ` (${totalGeral} no total)` : ""}
              </span>
              <span className="text-line">·</span>
              <label className="flex items-center gap-1.5">
                Exibir
                <select
                  value={consulta.porPagina}
                  onChange={(e) => aplicar({ porPagina: Number(e.target.value) })}
                  className="h-7 cursor-pointer appearance-none rounded-lg border border-line bg-surface px-2 text-xs font-medium text-ink focus:border-brand focus:outline-none"
                >
                  {POR_PAGINA.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                por página
              </label>
              {selected.size < total && (
                <>
                  <span className="text-line">·</span>
                  <button
                    type="button"
                    onClick={selecionarTudoDoFiltro}
                    className="cursor-pointer font-medium text-brand-strong underline-offset-2 hover:underline"
                  >
                    Selecionar todos os {total}
                  </button>
                </>
              )}
            </div>

            {totalPaginas > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => aplicar({ pagina: Math.max(1, paginaAtual - 1) })}
                  disabled={paginaAtual <= 1}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-ink transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40"
                  aria-label="Página anterior"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="min-w-20 text-center text-xs font-medium text-muted">
                  Página {paginaAtual} de {totalPaginas}
                </span>
                <button
                  onClick={() => aplicar({ pagina: Math.min(totalPaginas, paginaAtual + 1) })}
                  disabled={paginaAtual >= totalPaginas}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-ink transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40"
                  aria-label="Próxima página"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        )}

        {sheet === "brand" && <BrandSheet open onClose={() => setSheet(null)} brands={brandOpts} />}
        {sheet === "category" && (
          extras
            ? <CategorySheet
                open
                onClose={() => setSheet(null)}
                tree={extras.categoryTree}
                onChanged={() => getGerenciarExtras().then(setExtras)}
              />
            : <LoadingSheet title="Categorias" onClose={() => setSheet(null)} />
        )}
        {sheet === "storage" && (
          extras
            ? <StorageSheet open onClose={() => setSheet(null)} locations={extras.storageOpts} sites={extras.siteOpts} />
            : <LoadingSheet title="Armazenagem" onClose={() => setSheet(null)} />
        )}
        {sheet === "supplier" && (
          extras
            ? <SupplierSheet open onClose={() => setSheet(null)} suppliers={extras.supplierRows} />
            : <LoadingSheet title="Fornecedores" onClose={() => setSheet(null)} />
        )}
        {sheet === "csv" && <CsvSheet open onClose={() => setSheet(null)} policy={policy} />}
        {sheet === "imagens" && (
          <ImagensSheet
            open
            onClose={() => setSheet(null)}
            produtos={imagensAlvo}
            onAplicado={() => router.refresh()}
          />
        )}
        {sheet === "lote" && (
          extras
            ? <LoteSheet
                open
                onClose={() => setSheet(null)}
                produtos={loteAlvo}
                categoryTree={extras.categoryTree}
                brands={brandOpts}
                suppliers={extras.supplierRows}
                fiscais={extras.fiscalOpts}
                etiquetasExistentes={tagOpts}
                onAplicado={() => { setSelected(new Set()); router.refresh(); }}
              />
            : <LoadingSheet title="Editar em lote" onClose={() => setSheet(null)} />
        )}
        {sheet === "nomes" && (
          <NomesSheet
            open
            onClose={() => setSheet(null)}
            produtos={nomesAlvo}
            onAplicado={() => { setSelected(new Set()); router.refresh(); }}
          />
        )}
      </div>

      {/* ── Barra de ações em lote ──
          Some enquanto um painel está aberto: ela é `fixed` no rodapé e, vindo
          depois no DOM, ficava por cima do rodapé do slide-over — engolindo o
          botão de salvar do painel que ela mesma abriu. */}
      {selected.size > 0 && !painelAberto && (
        <BulkBar
          count={selected.size}
          ocupado={ocupado}
          onEditar={() => comSelecao(abrirLote)}
          onNomes={() => comSelecao(abrirNomes)}
          onEtiquetas={() => comSelecao((l) => { setEtiquetasAlvo(l); setEtiquetasOpen(true); })}
          onExportar={exportar}
          onImagens={() => comSelecao(abrirImagens)}
          onLimpar={() => setSelected(new Set())}
        />
      )}

      {etiquetasOpen && (
        <EtiquetasSheet
          open
          onClose={() => setEtiquetasOpen(false)}
          products={etiquetasAlvo}
        />
      )}

      {selectedProduct && (() => {
        // Posição na página que está na tela — navegar não muda de página.
        const idx = rows.findIndex((r) => r.id === selectedProduct.id);
        return (
          <ProductSidePanel
            key={selectedProduct.id}
            product={selectedProduct}
            onClose={() => setSelectedProduct(null)}
            onEdit={() => router.push(`/produtos/${selectedProduct.id}/editar`)}
            navegacao={
              idx >= 0
                ? {
                    posicao: inicio + idx + 1,
                    total,
                    onAnterior: idx > 0 ? () => setSelectedProduct(rows[idx - 1]) : undefined,
                    onProximo: idx < rows.length - 1 ? () => setSelectedProduct(rows[idx + 1]) : undefined,
                  }
                : undefined
            }
          />
        );
      })()}

      {imageUrl && <ImageViewer url={imageUrl} onClose={() => setImageUrl(null)} />}
    </>
  );
}

// ── Vazio por filtro ─────────────────────────────────────────────────────────

/** Vazio que diz QUAL filtro esvaziou a tela e deixa tirar só ele. */
function SemResultado({
  chips, onLimparTudo,
}: {
  chips: { key: string; label: string; limpar: () => void }[];
  onLimparTudo: () => void;
}) {
  const ultimo = chips[chips.length - 1];
  return (
    <div className="mt-12 flex flex-col items-center gap-3 text-center">
      <p className="text-sm text-muted">
        {chips.length === 0
          ? "Nenhum produto por aqui."
          : chips.length === 1
            ? `Nenhum produto em "${chips[0].label}".`
            : `Nenhum produto bate com os ${chips.length} filtros.`}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {ultimo && (
          <Button variant="outline" size="sm" onClick={ultimo.limpar} className="gap-1.5">
            <X size={15} /> Tirar “{ultimo.label}”
          </Button>
        )}
        {chips.length > 1 && (
          <Button variant="ghost" size="sm" onClick={onLimparTudo} className="gap-1.5">
            <FilterX size={15} /> Limpar tudo
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Cabeçalho ordenável ───────────────────────────────────────────────────────

function SortableTh({
  label, field, sort, dir, onSort, className,
}: {
  label: string;
  field: ProdutoSortField;
  sort: ProdutoSortField;
  dir: ProdutoSortDir;
  onSort: (f: ProdutoSortField) => void;
  className?: string;
}) {
  const active = sort === field;
  return (
    <th className={cn("px-4 py-2.5", className)}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          "-mx-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 uppercase transition-colors hover:text-ink",
          active && "text-ink",
        )}
        aria-label={`Ordenar por ${label}`}
      >
        {label}
        {active
          ? (dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)
          : <ChevronsUpDown size={12} className="opacity-40" />}
      </button>
    </th>
  );
}

// ── Checkbox (com estado indeterminado e seleção por intervalo) ──────────────

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
    <Checkbox
      checked={checked}
      indeterminate={indeterminate}
      onChange={() => onChange(shiftRef.current)}
      // O evento de change não carrega o shift; o clique carrega.
      onClick={(e) => { shiftRef.current = e.shiftKey; e.stopPropagation(); }}
      aria-label={label}
    />
  );
}

function CheckRow({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-sm text-ink transition-colors hover:bg-surface-2">
      <Checkbox checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

function DensityBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
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

// ── Barra de ações em lote (flutuante) ───────────────────────────────────────

function BulkBar({
  count, ocupado, onEditar, onNomes, onEtiquetas, onExportar, onImagens, onLimpar,
}: {
  count: number;
  ocupado: boolean;
  /** Categoria/subcategoria, marca, preço, fiscal e fornecedores dos selecionados. */
  onEditar: () => void;
  onNomes: () => void;
  onEtiquetas: () => void;
  onExportar: (formato: "csv" | "xlsx") => void;
  onImagens: () => void;
  onLimpar: () => void;
}) {
  return (
    // z-40: um degrau abaixo do slide-over (z-50). Empatar em 50 fazia a ordem
    // do DOM decidir quem cobre quem — e a barra ganhava.
    <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="flex flex-wrap items-center justify-center gap-2 rounded-full border border-line bg-surface px-3 py-2 shadow-[var(--shadow-2)]">
        <span className="pl-1 pr-1 text-sm font-medium text-ink">
          {count} selecionado{count === 1 ? "" : "s"}
        </span>
        <div className="h-5 w-px bg-line" />
        <Button size="sm" onClick={onEditar} disabled={ocupado} className="gap-1.5">
          <SlidersHorizontal size={15} /> Editar em lote
        </Button>
        <Button variant="ghost" size="sm" onClick={onNomes} disabled={ocupado} className="gap-1.5">
          <TextCursorInput size={15} /> Alterar nomes
        </Button>
        <Button variant="ghost" size="sm" onClick={onEtiquetas} disabled={ocupado} className="gap-1.5">
          <Printer size={15} /> Imprimir etiquetas
        </Button>
        <Button variant="ghost" size="sm" onClick={onImagens} disabled={ocupado} className="gap-1.5">
          <ImagePlus size={15} /> Buscar imagens
        </Button>
        <Menu
          align="end"
          trigger={
            <Button variant="ghost" size="sm" disabled={ocupado} className="gap-1.5">
              <Download size={15} /> Exportar
              <ChevronUp size={14} className="-mr-0.5 text-muted" />
            </Button>
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
          onClick={onLimpar}
          className="ml-1 cursor-pointer rounded-full p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          aria-label="Limpar seleção"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

// ── Card mobile ──────────────────────────────────────────────────────────────

/**
 * Card de produto — usado no mobile (sempre) e na densidade "Card"
 * (grid em todas as telas). `big` deixa o card mais espaçoso e mostra
 * categoria/tipo, que não cabem na versão compacta do mobile.
 */
function ProductCard({
  p, giro, selected, onToggle, onOpen, onImage, onEdit, onArchive, onBuscarImagem, big, cols, info,
}: {
  p: ProductRow;
  giro?: ProdutoGiro;
  selected: boolean;
  onToggle: (shift: boolean) => void;
  onOpen: () => void;
  onImage?: () => void;
  onEdit: () => void;
  onArchive: () => void;
  /** Busca a foto do produto pelo código de barras. */
  onBuscarImagem: () => void;
  big?: boolean;
  cols: Record<ColKey, boolean>;
  info: Record<InfoKey, boolean>;
}) {
  const level = stockLevel(p);
  const qty = stockQty(p);
  const m = p.tipo === "INSUMO" ? null : margem(p.precoVenda, p.custo);
  const principal = principalFornecedor(p);

  // Metadados (tipo/categoria/marca/fornecedor) — só no card grande, e só o que
  // estiver ligado em Exibição → Colunas.
  const metaParts: { key: string; node: React.ReactNode }[] = [];
  if (cols.tipo) metaParts.push({ key: "tipo", node: <span className="inline-flex items-center gap-1">{TIPO_ICON[p.tipo]}{TIPO_LABEL[p.tipo]}</span> });
  if (cols.categoria && p.categoriaNome) metaParts.push({ key: "cat", node: p.categoriaNome });
  if (cols.local) {
    const locais = locaisEmUso(p);
    if (locais.length) {
      const [primeiro] = locais;
      const Icon = primeiro.tipo ? STORAGE_TIPO_ICON[primeiro.tipo] : Warehouse;
      const cor = primeiro.tipo ? STORAGE_TIPO_COLOR[primeiro.tipo] : undefined;
      metaParts.push({
        key: "local",
        node: (
          <span className="inline-flex items-center gap-1">
            <Icon size={11} className={cor} />
            {primeiro.nome}
            {locais.length > 1 ? ` +${locais.length - 1}` : ""}
          </span>
        ),
      });
    }
  }
  if (cols.marca && p.marca) metaParts.push({ key: "marca", node: p.marca });
  if (cols.fornecedor && principal) metaParts.push({ key: "forn", node: principal.nome });

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-[var(--radius)] border border-line bg-surface",
        big ? "p-3.5" : "items-center p-2.5",
        selected && "border-brand/40 bg-brand-soft/40",
        !p.ativo && "opacity-50",
      )}
    >
      <Check checked={selected} onChange={onToggle} label={`Selecionar ${p.nome}`} />
      <button type="button" onClick={onOpen} className={cn("flex min-w-0 flex-1 gap-3 text-left", big ? "items-start" : "items-center")}>
        <Thumb url={p.imagemUrl} tipo={p.tipo} onClickImage={onImage} big={big} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn("truncate font-semibold text-ink", big ? "text-[14px]" : "text-[13px]")}>{p.nome}</span>
            {p.vendeOnline && <Globe size={12} className="shrink-0 text-brand" />}
            {info.restricao && p.restricaoIdade && (
              <span className="inline-flex items-center rounded-full border border-danger/30 bg-danger/10 px-1 py-px text-[9px] font-bold text-danger">+18</span>
            )}
          </div>

          {(info.sku || p.ean) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted">
              {info.sku && (
                <span className="inline-flex items-center gap-1"><Hash size={10} className="shrink-0" />{p.sku}</span>
              )}
              {p.ean && (
                <span className="inline-flex items-center gap-1"><Barcode size={10} className="shrink-0" />{p.ean}</span>
              )}
            </div>
          )}

          {big && metaParts.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-faint">
              {metaParts.map((part, i) => (
                <span key={part.key} className="inline-flex items-center gap-1">
                  {i > 0 && <span className="text-line">·</span>}
                  {part.node}
                </span>
              ))}
            </div>
          )}

          <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]", big ? "mt-2" : "mt-1.5")}>
            <span className="inline-flex items-center gap-1">
              <Tag size={11} className="shrink-0 text-faint" />
              {p.tipo === "INSUMO"
                ? <span className="text-faint">uso interno</span>
                : <span className="font-mono font-medium text-ink tnum">{brl(p.precoVenda)}</span>}
            </span>
            {cols.margem && m !== null && (
              <span className="inline-flex items-center gap-1 border-l border-line pl-3">
                <Percent size={11} className="shrink-0 text-faint" />
                <span className={cn("font-medium", margemColor(m))}>{m}%</span>
              </span>
            )}
            {cols.estoque && (
              <span className={cn("inline-flex items-center gap-1 border-l border-line pl-3 font-medium", STOCK_TEXT[level])}>
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STOCK_COLOR[level])} />
                {qty !== null ? `${qty} un` : STOCK_TITLE[level]}
                {p.estoque.aberto > 0 && <AbertaBadge size={15} />}
              </span>
            )}
            {cols.vendas && p.tipo !== "INSUMO" && (
              <span className="inline-flex items-center gap-1 border-l border-line pl-3 text-muted">
                <TrendingUp size={11} className="shrink-0 text-faint" />
                <span className="font-mono tnum">{giro?.vendas30d ?? 0}</span> em 30d
              </span>
            )}
            {cols.parado && p.tipo !== "INSUMO" && (
              <span className="inline-flex items-center gap-1 border-l border-line pl-3 text-muted">
                <Clock size={11} className="shrink-0 text-faint" />
                {giro?.diasSemVenda == null ? "nunca vendeu" : `${giro.diasSemVenda}d parado`}
              </span>
            )}
          </div>
        </div>
      </button>
      <Menu
        align="end"
        trigger={
          <button className="shrink-0 cursor-pointer rounded-[var(--radius-sm)] p-1.5 text-faint hover:bg-surface-2 hover:text-ink" aria-label="Mais ações">
            <MoreVertical size={16} />
          </button>
        }
      >
        <MenuItem icon={<Pencil size={15} />} onClick={onEdit}>Editar</MenuItem>
        <MenuItem icon={<ImagePlus size={15} />} onClick={onBuscarImagem} disabled={!p.ean}>
          Buscar imagem
        </MenuItem>
        <div className="my-1 h-px bg-line" role="separator" />
        <MenuItem icon={p.ativo ? <EyeOff size={15} /> : <Eye size={15} />} onClick={onArchive}>
          {p.ativo ? "Inativar" : "Ativar"}
        </MenuItem>
      </Menu>
    </li>
  );
}

// ── Exportação CSV ────────────────────────────────────────────────────────────

type Tabela = { cabecalho: string[]; linhas: (string | number | null)[][] };

/**
 * Monta a tabela do export a partir do que está na tela: as colunas ligadas em
 * Exibição, na ordem da tabela. Planilha que não bate com a tela é planilha que
 * ninguém confere.
 *
 * Números saem como número (não como texto com vírgula) — quem abre no Excel
 * quer somar a coluna. A vírgula decimal fica a cargo do CSV.
 */
function montarTabela(
  rows: ProductRow[],
  giro: Record<string, ProdutoGiro>,
  cols: Record<ColKey, boolean>,
  info: Record<InfoKey, boolean>,
): Tabela {
  type Coluna = { titulo: string; valor: (p: ProductRow) => string | number | null };

  const colunas: Coluna[] = [{ titulo: "Nome", valor: (p) => p.nome }];
  if (info.sku) colunas.push({ titulo: "SKU", valor: (p) => p.sku });
  colunas.push({ titulo: "EAN", valor: (p) => p.ean });
  if (cols.marca) colunas.push({ titulo: "Marca", valor: (p) => p.marca });
  if (cols.tipo) colunas.push({ titulo: "Tipo", valor: (p) => TIPO_LABEL[p.tipo] ?? p.tipo });
  if (cols.categoria) {
    colunas.push({ titulo: "Categoria", valor: (p) => p.categoriaNome });
    colunas.push({ titulo: "Subcategoria", valor: (p) => p.subcategoriaNome });
  }
  if (cols.local) {
    colunas.push({ titulo: "Local", valor: (p) => locaisEmUso(p).map((l) => l.nome).join(" / ") });
  }
  colunas.push({ titulo: "Preço", valor: (p) => p.precoVenda });
  colunas.push({ titulo: "Custo", valor: (p) => p.custo });
  if (cols.margem) {
    colunas.push({ titulo: "Margem %", valor: (p) => margem(p.precoVenda, p.custo) });
  }
  if (cols.estoque) colunas.push({ titulo: "Estoque", valor: (p) => stockQty(p) });
  if (cols.fornecedor) {
    colunas.push({ titulo: "Fornecedor", valor: (p) => principalFornecedor(p)?.nome ?? "" });
  }
  if (cols.vendas) colunas.push({ titulo: "Vendas 30d", valor: (p) => giro[p.id]?.vendas30d ?? 0 });
  if (cols.parado) {
    colunas.push({ titulo: "Dias sem venda", valor: (p) => giro[p.id]?.diasSemVenda ?? null });
  }
  if (info.restricao) colunas.push({ titulo: "+18", valor: (p) => (p.restricaoIdade ? "Sim" : "Não") });
  colunas.push({ titulo: "Ativo", valor: (p) => (p.ativo ? "Sim" : "Não") });

  return {
    cabecalho: colunas.map((c) => c.titulo),
    linhas: rows.map((p) => colunas.map((c) => c.valor(p))),
  };
}

function csvCell(v: string | number | null): string {
  if (v == null) return "";
  // Vírgula decimal: no CSV o separador é `;`, então não conflita.
  const s = typeof v === "number" ? String(v).replace(".", ",") : v;
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function baixarCsv(t: Tabela) {
  const linhas = t.linhas.map((l) => l.map(csvCell).join(";"));
  const csv = "﻿" + [t.cabecalho.join(";"), ...linhas].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `produtos-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Thumb com hover e clique ──────────────────────────────────────────────────

function Thumb({
  url, tipo, onClickImage, big,
}: {
  url: string | null;
  tipo: string;
  onClickImage?: () => void;
  big?: boolean;
}) {
  const size = big ? "h-12 w-12" : "h-9 w-9";
  if (url) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClickImage?.(); }}
        className={cn("relative shrink-0 cursor-zoom-in overflow-hidden rounded-[var(--radius-sm)] border border-line group/img", size)}
      >
        {/*
          `<img>` cru em vez de next/image: a foto pode vir de qualquer host
          (base de EAN, URL colada pelo operador, data: de upload) e o
          otimizador exige allowlist. O que importava para a rolagem está aqui:
          carrega só quando aparece e já reserva o espaço.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          width={big ? 48 : 36}
          height={big ? 48 : 36}
          className="h-full w-full object-cover"
        />
        <span className="absolute inset-0 grid place-items-center bg-ink/25 opacity-0 transition-opacity group-hover/img:opacity-100">
          <Eye size={big ? 16 : 13} className="text-white drop-shadow" />
        </span>
      </button>
    );
  }
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface-2 text-faint", size)}>
      {tipo === "INSUMO" ? <PackageOpen size={big ? 18 : 15} /> : <Wine size={big ? 18 : 15} />}
    </span>
  );
}

// ── Célula de códigos de barra com tooltip portal ────────────────────────────

function BarcodeCell({
  sku, ean, packagings, showSku = true,
}: {
  sku: string;
  ean: string | null;
  packagings: ProductPackagingItem[];
  showSku?: boolean;
}) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);

  const codes = [
    ean ? { label: "Unid.", code: ean } : null,
    ...packagings.filter((pk) => !!pk.ean).map((pk) => ({
      label: `${pk.nome} ${pk.fatorConversao}x`,
      code: pk.ean!,
    })),
  ].filter(Boolean) as { label: string; code: string }[];

  const hasCodes = codes.length > 0;

  function handleEnter() {
    if (!hasCodes) return;
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.top + window.scrollY, left: rect.left + window.scrollX });
    setShow(true);
  }

  return (
    <>
      <div
        ref={ref}
        className={cn("mt-0.5 flex items-center gap-3", hasCodes && "cursor-help")}
        onMouseEnter={handleEnter}
        onMouseLeave={() => setShow(false)}
      >
        {showSku && (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-2">
            <Hash size={10} className="shrink-0 text-muted" />
            {sku}
          </span>
        )}
        {ean && (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-2">
            <Barcode size={10} className="shrink-0 text-muted" />
            {ean}
          </span>
        )}
      </div>

      {show && hasCodes && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-[100] min-w-[200px] rounded-lg border border-line bg-surface p-2.5 shadow-lg"
          style={{ top: pos.top - 8, left: pos.left, transform: "translateY(-100%)" }}
          onMouseEnter={() => setShow(true)}
          onMouseLeave={() => setShow(false)}
        >
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
            <Barcode size={11} /> Códigos de barra
          </div>
          <div className="space-y-1">
            {codes.map((item) => (
              <div key={item.code} className="flex items-center gap-3 text-[11px]">
                <span className="w-20 shrink-0 text-faint">{item.label}</span>
                <span className="font-mono text-ink">{item.code}</span>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ── Visualizador de imagem em tela cheia ────────────────────────────────────

function ImageViewer({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", fn);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", fn);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-8"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-ink/85 backdrop-blur-sm" aria-hidden />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        className="relative max-h-full max-w-full rounded-[var(--radius-lg)] object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/25"
        aria-label="Fechar"
      >
        <X size={18} />
      </button>
    </div>
  );
}

// ── Célula de estoque (número inline + medidor + tooltip por loja) ────────────

function StockCell({ p, level }: { p: ProductRow; level: "ok" | "warn" | "danger" }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);

  const qty = stockQty(p);
  const semControle = qty === null;

  // Só locais ativos (locationAtivo === false = arquivado); agrupa por loja.
  const lojas = useMemo(() => {
    const map = new Map<string, { siteNome: string; fechado: number; aberto: number }>();
    for (const l of p.locais) {
      if (!l.siteAtivo) continue;
      if (l.locationAtivo === false) continue;
      const cur = map.get(l.siteId) ?? { siteNome: l.siteNome, fechado: 0, aberto: 0 };
      cur.fechado += l.fechado;
      cur.aberto += l.aberto;
      map.set(l.siteId, cur);
    }
    return [...map.values()];
  }, [p.locais]);

  const hasDetail = lojas.length > 0;

  // Medidor sempre presente — é a assinatura da tela, e trilho vazio também
  // informa ("este produto não tem meta"). Meta = ideal; sem ideal, o dobro do
  // mínimo (o ponto onde repor deixa de ser urgente).
  const meta = p.estoque.ideal > 0 ? p.estoque.ideal : p.estoque.minimo > 0 ? p.estoque.minimo * 2 : 0;
  const pct = meta > 0 && qty !== null ? Math.max(0, Math.min(100, Math.round((qty / meta) * 100))) : null;
  const marcaMinimo =
    meta > 0 && p.estoque.minimo > 0 ? Math.min(97, Math.round((p.estoque.minimo / meta) * 100)) : null;

  function handleEnter() {
    if (!hasDetail) return;
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.top + window.scrollY, left: rect.left + window.scrollX });
    setShow(true);
  }

  if (semControle) {
    return <span className="text-[12px] text-muted">Sem controle</span>;
  }

  return (
    <>
      <div
        ref={ref}
        className={cn("inline-flex flex-col gap-1", hasDetail && "cursor-help")}
        onMouseEnter={handleEnter}
        onMouseLeave={() => setShow(false)}
      >
        <span className={cn("inline-flex items-center gap-1.5 text-[12px] font-medium", STOCK_TEXT[level])}>
          <span className={cn("h-2 w-2 shrink-0 rounded-full", STOCK_COLOR[level])} />
          <span className="font-mono tnum text-[13px]">{qty}</span>
          <span className="text-[11px] font-normal text-muted">un</span>
          {p.estoque.aberto > 0 && <AbertaBadge size={16} />}
        </span>
        <span
          className={cn("relative h-1 w-16 overflow-hidden rounded-full bg-line", pct === null && "opacity-40")}
          aria-hidden
        >
          {pct !== null && (
            <span className={cn("block h-full rounded-full", STOCK_COLOR[level])} style={{ width: `${pct}%` }} />
          )}
          {marcaMinimo !== null && (
            <span
              className="absolute inset-y-0 w-px bg-ink/40"
              style={{ left: `${marcaMinimo}%` }}
              title="Estoque mínimo"
            />
          )}
        </span>
      </div>

      {show && hasDetail && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-[100] min-w-50 max-w-70 rounded-lg border border-line bg-surface p-2.5 shadow-lg"
          style={{ top: pos.top - 8, left: pos.left, transform: "translateY(-100%)" }}
          onMouseEnter={() => setShow(true)}
          onMouseLeave={() => setShow(false)}
        >
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">Estoque por loja</p>
          <ul className="space-y-2">
            {lojas.map((l, i) => (
              <li key={i} className="text-[12px] leading-snug">
                <span className="font-semibold text-ink-2">{l.siteNome}</span>
                <p className="text-muted">
                  <span className="font-mono font-medium text-ink tnum">{l.fechado}</span> un.
                  {/* aberto é o ml/g restante da garrafa em uso, não uma contagem — só existe 1 aberta por vez. */}
                  {l.aberto > 0 && (
                    <>
                      {" "}e{" "}
                      <span className="font-mono font-medium text-ink tnum">1</span> aberta
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}

// ── Células de giro ──────────────────────────────────────────────────────────

function VendasCell({ giro, tipo }: { giro?: ProdutoGiro; tipo: string }) {
  if (tipo === "INSUMO") return <span className="text-[11px] text-faint">—</span>;
  const n = giro?.vendas30d ?? 0;
  return (
    <span className={cn("font-mono text-[13px] tnum", n > 0 ? "font-medium text-ink" : "text-faint")}>
      {n}
    </span>
  );
}

function ParadoCell({ giro, tipo }: { giro?: ProdutoGiro; tipo: string }) {
  if (tipo === "INSUMO") return <span className="text-[11px] text-faint">—</span>;
  const d = giro?.diasSemVenda;
  if (d == null) return <span className="text-[11px] text-muted">nunca vendeu</span>;
  return (
    <span
      className={cn(
        "font-mono text-[12px] tnum",
        d >= 60 ? "font-medium text-danger" : d >= 30 ? "text-warn" : "text-ink-2",
      )}
    >
      {d}d
    </span>
  );
}

// ── Célula de preço: tooltip (custo × venda) + edição inline ─────────────────

/**
 * Duplo clique abre o campo na própria linha. Remarcar preço é a operação mais
 * repetida da tela — mandar para o cadastro inteiro custa quatro cliques e uma
 * navegação por produto.
 */
function PriceCell({
  produtoId, nome, tipo, precoVenda, custo, onSalvo,
}: {
  produtoId: string;
  nome: string;
  tipo: string;
  precoVenda: number | null;
  custo: number | null;
  onSalvo: () => void;
}) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState("");
  const [salvando, setSalvando] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const hasBoth = precoVenda != null && custo != null;

  function abrir() {
    if (tipo === "INSUMO") return;
    setValor(moneyToMask(precoVenda));
    setEditando(true);
    setShow(false);
  }

  function salvar() {
    const novo = parseMoney(valor);
    if (novo === precoVenda || (novo == null && precoVenda == null)) {
      setEditando(false);
      return;
    }
    setSalvando(true);
    setPrecoVenda(produtoId, novo)
      .then(() => {
        setEditando(false);
        toast.success(`${nome}: ${novo == null ? "preço removido" : brl(novo)}`);
        onSalvo();
      })
      .catch((e) =>
        toast.error("Não deu para salvar o preço", e instanceof Error ? e.message : undefined),
      )
      .finally(() => setSalvando(false));
  }

  function handleEnter() {
    if (!hasBoth || editando) return;
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.top + window.scrollY, left: rect.left + window.scrollX });
    setShow(true);
  }

  if (tipo === "INSUMO") return <span className="text-[11px] text-faint">uso interno</span>;

  if (editando) {
    // h-7 nos três: a linha não pode crescer ao entrar em edição, senão a
    // tabela inteira desce dois pixels e o olho perde o lugar.
    return (
      <div className="flex h-7 items-center gap-1">
        <Input
          autoFocus
          value={valor}
          onChange={(e) => setValor(maskMoney(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); salvar(); }
            if (e.key === "Escape") { e.preventDefault(); setEditando(false); }
          }}
          disabled={salvando}
          inputMode="numeric"
          aria-label={`Preço de ${nome}`}
          className="h-7 w-24 px-2 text-right font-mono text-[13px]"
        />
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          aria-label="Salvar preço"
          className="grid h-7 w-7 cursor-pointer place-items-center rounded-full text-ok transition-colors hover:bg-ok-soft disabled:opacity-40"
        >
          <CheckIcon size={14} />
        </button>
        <button
          type="button"
          onClick={() => setEditando(false)}
          aria-label="Cancelar"
          className="grid h-7 w-7 cursor-pointer place-items-center rounded-full text-faint transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        ref={ref}
        onDoubleClick={abrir}
        className={cn("group/preco flex h-7 items-center gap-1.5", hasBoth && "cursor-help")}
        onMouseEnter={handleEnter}
        onMouseLeave={() => setShow(false)}
        title="Duplo clique para remarcar"
      >
        {precoVenda != null
          ? <span className="font-mono text-[13px] font-medium text-ink tnum">{brl(precoVenda)}</span>
          : <span className="text-[11px] font-medium text-warn">Sem preço</span>}
        <button
          type="button"
          onClick={abrir}
          aria-label={`Editar preço de ${nome}`}
          className="cursor-pointer rounded-full p-1 text-faint opacity-0 transition-opacity hover:bg-surface-2 hover:text-ink group-hover/preco:opacity-100 focus-visible:opacity-100"
        >
          <Pencil size={12} />
        </button>
      </div>

      {show && hasBoth && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-[100] min-w-[180px] rounded-lg border border-line bg-surface p-2.5 shadow-lg"
          style={{ top: pos.top - 8, left: pos.left, transform: "translateY(-100%)" }}
          onMouseEnter={() => setShow(true)}
          onMouseLeave={() => setShow(false)}
        >
          <div className="space-y-1.5 text-[12px]">
            <div className="flex items-center justify-between gap-4">
              <span className="text-faint">Preço base</span>
              <span className="font-mono font-medium text-ink tnum">{brl(custo)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-faint">Preço de venda</span>
              <span className="font-mono font-medium text-ink tnum">{brl(precoVenda)}</span>
            </div>
            {margem(precoVenda, custo) !== null && (
              <div className="border-t border-line pt-1.5 flex items-center justify-between gap-4">
                <span className="text-faint">Margem</span>
                <span className={cn("font-mono font-medium tnum", margemColor(margem(precoVenda, custo)))}>{margem(precoVenda, custo)}%</span>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ── Célula de local de armazenagem ───────────────────────────────────────────

function LocalCell({ locais }: { locais: LocalEmUso[] }) {
  if (locais.length === 0) return <span className="text-[11px] text-faint">—</span>;
  const [primeiro] = locais;
  const Icon = primeiro.tipo ? STORAGE_TIPO_ICON[primeiro.tipo] : Warehouse;
  const cor = primeiro.tipo ? STORAGE_TIPO_COLOR[primeiro.tipo] : "text-faint";
  return (
    <span
      className="inline-flex items-center gap-1 text-[12px] text-ink-2"
      title={locais.map((l) => l.nome).join(" · ")}
    >
      <Icon size={12} className={cn("shrink-0", cor)} />
      <span className="truncate">{primeiro.nome}</span>
      {locais.length > 1 && (
        <span className="text-[11px] text-faint">+{locais.length - 1}</span>
      )}
    </span>
  );
}

// ── Célula de margem (colorida por faixa) ────────────────────────────────────

function MargemCell({ precoVenda, custo, tipo }: { precoVenda: number | null; custo: number | null; tipo: string }) {
  if (tipo === "INSUMO") return <span className="text-[11px] text-faint">—</span>;
  const m = margem(precoVenda, custo);
  if (m === null) return <span className="text-[11px] text-faint">—</span>;
  return <span className={cn("text-[12px] font-semibold tnum", margemColor(m))}>{m}%</span>;
}

function LoadingSheet({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title={title}>
      <p className="py-8 text-center text-sm text-muted">Carregando…</p>
    </Sheet>
  );
}

function EmptyState({ onNew, onCsv }: { onNew: () => void; onCsv: () => void }) {
  return (
    <div className="mt-10 flex flex-col items-center gap-4 rounded-[var(--radius-lg)] border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-brand-soft text-brand-strong">
        <Wine size={26} />
      </span>
      <div>
        <h2 className="font-display text-lg font-semibold text-ink">Comece pela sua prateleira</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
          Escaneie um código de barras e deixe a IA preencher, ou traga sua planilha atual de uma vez.
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={onNew} className="gap-1.5"><Plus size={16} /> Cadastrar produto</Button>
        <Button variant="outline" onClick={onCsv} className="gap-1.5"><Upload size={16} /> Importar CSV</Button>
      </div>
    </div>
  );
}
