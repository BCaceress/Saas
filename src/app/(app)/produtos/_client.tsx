"use client";

import { useMemo, useState, useTransition, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus, Tag, FolderTree, Warehouse, Truck, Upload, Search, Settings2,
  Pencil, PackageOpen, Wine, ChevronDown, Boxes,
  MoreVertical, EyeOff, Eye, X,
  Barcode, Hash, ChevronLeft, ChevronRight,
  ArrowUp, ArrowDown, ChevronsUpDown, Globe, SlidersHorizontal, Columns3,
  Download, Rows2, LayoutGrid, FilterX, Percent, BottleWine, Printer, ImagePlus,
} from "lucide-react";
import { cn, brl, margem } from "@/lib/utils";
import { POLICY_PADRAO, type EstoquePolicy } from "@/lib/estoque-estrategia";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Input, Select } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { PageHeader } from "@/components/app/page-header";
import { navIcon } from "@/components/app/nav-config";
import {
  ProductSidePanel, stockLevel, TIPO_LABEL, TIPO_ICON, STOCK_COLOR, STOCK_TITLE, STOCK_TEXT,
} from "@/components/app/product-side-panel";
import { BrandSheet, CategorySheet, StorageSheet, SupplierSheet } from "./_sheets/sidepanels";
import { CsvSheet } from "./_sheets/csv-sheet";
import { EtiquetasSheet } from "./_sheets/etiquetas-sheet";
import { ImagensSheet, type ProdutoImagem } from "./_sheets/imagens-sheet";
import { archiveProduct, getGerenciarExtras } from "./actions";
import type {
  ProductRow, BrandOpt, SubcategoryFilterOpt,
  ProductPackagingItem,
} from "./_types";
import type { GerenciarExtras } from "./_data";

type SheetKind = null | "brand" | "category" | "storage" | "supplier" | "csv" | "imagens";

/**
 * Teto de produtos por rodada de busca de imagem. A cota da base de códigos é
 * finita: melhor rodar em tandas e ver o resultado do que queimar tudo de uma vez.
 */
const IMAGENS_POR_RODADA = 100;

const POR_PAGINA = [25, 50, 100, 200];

// ── Ordenação ────────────────────────────────────────────────────────────────
type SortField = "nome" | "marca" | "tipo" | "categoria" | "preco" | "margem" | "estoque" | "fornecedor";
type SortDir = "asc" | "desc";

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

function sortValue(p: ProductRow, field: SortField): number | string {
  switch (field) {
    case "nome": return p.nome.toLowerCase();
    case "marca": return (p.marca ?? "").toLowerCase();
    case "tipo": return TIPO_LABEL[p.tipo] ?? p.tipo;
    case "categoria": return `${p.categoriaNome} ${p.subcategoriaNome}`.toLowerCase();
    case "fornecedor": return (principalFornecedor(p)?.nome ?? "").toLowerCase();
    case "preco": return p.precoVenda ?? Number.NEGATIVE_INFINITY;
    case "margem": return margem(p.precoVenda, p.custo) ?? Number.NEGATIVE_INFINITY;
    case "estoque": return stockQty(p) ?? Number.NEGATIVE_INFINITY;
  }
}

// ── Colunas configuráveis ────────────────────────────────────────────────────
type ColKey = "marca" | "tipo" | "categoria" | "margem" | "fornecedor" | "estoque";
const COL_ORDER: ColKey[] = ["marca", "tipo", "categoria", "margem", "fornecedor", "estoque"];
const COL_LABEL: Record<ColKey, string> = {
  marca: "Marca", tipo: "Tipo", categoria: "Categoria",
  margem: "Margem", fornecedor: "Fornecedor", estoque: "Estoque",
};
const DEFAULT_COLS: Record<ColKey, boolean> = {
  marca: false, tipo: true, categoria: true,
  margem: true, fornecedor: true, estoque: true,
};
type Density = "cozy" | "compact";

// ── Informativos (badges auxiliares, independentes de coluna) ───────────────
type InfoKey = "restricao" | "sku";
const INFO_ORDER: InfoKey[] = ["restricao", "sku"];
const INFO_LABEL: Record<InfoKey, string> = { restricao: "Restrição +18", sku: "SKU" };
const DEFAULT_INFO: Record<InfoKey, boolean> = { restricao: true, sku: true };

// ── Filtros de higiene/negócio (booleanos) ───────────────────────────────────
type Flags = {
  semPreco: boolean; semImagem: boolean; semEan: boolean; online: boolean; maiorIdade: boolean;
};
const NO_FLAGS: Flags = { semPreco: false, semImagem: false, semEan: false, online: false, maiorIdade: false };
const FLAG_LABEL: Record<keyof Flags, string> = {
  semPreco: "Sem preço", semImagem: "Sem imagem", semEan: "Sem código de barras",
  online: "Vende online", maiorIdade: "Restrição +18",
};

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

export function ProdutosClient(props: {
  rows: ProductRow[];
  subOpts: SubcategoryFilterOpt[];
  brandOpts: BrandOpt[];
  initialFornecedorId?: string;
  initialFornecedorNome?: string;
  /** Estratégia de estoque — define as colunas do importador de CSV. */
  policy?: EstoquePolicy;
}) {
  const { rows, subOpts, brandOpts, initialFornecedorId, initialFornecedorNome, policy = POLICY_PADRAO } = props;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, start] = useTransition();

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

  // ── Estado de filtros (inicializado a partir da URL: bookmarkável/compartilhável) ──
  // Lido só na montagem; depois o estado local é a fonte de verdade e é espelhado
  // de volta na URL pelo efeito abaixo.
  const [q, setQ] = useState(() => searchParams.get("q") ?? "");
  const [fTipo, setFTipo] = useState(() => searchParams.get("tipo") ?? "");
  const [fSub, setFSub] = useState(() => searchParams.get("sub") ?? "");
  const [fMarca, setFMarca] = useState(() => searchParams.get("marca") ?? "");
  const [fFornecedorId, setFFornecedorId] = useState(
    () => searchParams.get("fornecedorId") ?? initialFornecedorId ?? ""
  );
  const [fStatus, setFStatus] = useState(
    () => searchParams.get("status") ?? (initialFornecedorId ? "nao_arquivados" : "ativos")
  );
  const [flags, setFlags] = useState<Flags>(() => ({
    semPreco: searchParams.get("f_semPreco") === "1",
    semImagem: searchParams.get("f_semImagem") === "1",
    semEan: searchParams.get("f_semEan") === "1",
    online: searchParams.get("f_online") === "1",
    maiorIdade: searchParams.get("f_maiorIdade") === "1",
  }));

  const [sort, setSort] = useState<SortField>(() => (searchParams.get("sort") as SortField) || "nome");
  const [dir, setDir] = useState<SortDir>(() => (searchParams.get("dir") as SortDir) || "asc");

  const [porPagina, setPorPagina] = useState(() => Number(searchParams.get("pp")) || 50);
  const [pagina, setPagina] = useState(() => Number(searchParams.get("pg")) || 1);

  // Preferências de exibição (persistem no navegador, não na URL).
  const [cols, setCols] = useState<Record<ColKey, boolean>>(() => readLS("produtos:cols", DEFAULT_COLS));
  const [info, setInfo] = useState<Record<InfoKey, boolean>>(() => readLS("produtos:info", DEFAULT_INFO));
  const [density, setDensity] = useState<Density>(() => readLS("produtos:ui", { density: "compact" as Density }).density);
  useEffect(() => { try { localStorage.setItem("produtos:cols", JSON.stringify(cols)); } catch {} }, [cols]);
  useEffect(() => { try { localStorage.setItem("produtos:info", JSON.stringify(info)); } catch {} }, [info]);
  useEffect(() => { try { localStorage.setItem("produtos:ui", JSON.stringify({ density })); } catch {} }, [density]);

  // Seleção em lote.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [etiquetasOpen, setEtiquetasOpen] = useState(false);

  function toggleSort(field: SortField) {
    if (sort === field) { setDir((d) => (d === "asc" ? "desc" : "asc")); }
    else { setSort(field); setDir(field === "preco" || field === "margem" || field === "estoque" ? "desc" : "asc"); }
    resetPaging();
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((p) => {
      if (term && !`${p.nome} ${p.sku} ${p.ean ?? ""}`.toLowerCase().includes(term)) return false;
      if (fTipo && p.tipo !== fTipo) return false;
      if (fSub && p.subcategoryId !== fSub) return false;
      if (fMarca && p.brandId !== fMarca) return false;
      if (fFornecedorId && !p.fornecedores.some((f) => f.id === fFornecedorId)) return false;
      if (fStatus === "ativos" && !p.ativo) return false;
      if (fStatus === "inativos" && p.ativo) return false;
      if (flags.semPreco && !(p.precoVenda == null && p.tipo !== "INSUMO")) return false;
      if (flags.semImagem && p.imagemUrl != null) return false;
      if (flags.semEan && p.ean != null) return false;
      if (flags.online && !p.vendeOnline) return false;
      if (flags.maiorIdade && !p.restricaoIdade) return false;
      return true;
    });
  }, [rows, q, fTipo, fSub, fMarca, fFornecedorId, fStatus, flags]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const va = sortValue(a, sort);
      const vb = sortValue(b, sort);
      let cmp: number;
      if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb), "pt-BR");
      return dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sort, dir]);

  // Ao mudar filtro/ordenação/tamanho: volta pra primeira página e limpa a seleção.
  // Feito nos próprios handlers (não em efeito) — evita render em cascata.
  const resetPaging = useCallback(() => {
    setPagina(1);
    setSelected(new Set());
  }, []);

  const totalPaginas = Math.max(1, Math.ceil(sorted.length / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicio = (paginaAtual - 1) * porPagina;
  const paged = sorted.slice(inicio, inicio + porPagina);

  // ── Espelha filtros na URL (replace, sem poluir histórico), com debounce ──
  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (fTipo) p.set("tipo", fTipo);
      if (fSub) p.set("sub", fSub);
      if (fMarca) p.set("marca", fMarca);
      if (fFornecedorId) p.set("fornecedorId", fFornecedorId);
      if (fStatus !== "ativos") p.set("status", fStatus);
      if (sort !== "nome") p.set("sort", sort);
      if (dir !== "asc") p.set("dir", dir);
      if (porPagina !== 50) p.set("pp", String(porPagina));
      if (paginaAtual > 1) p.set("pg", String(paginaAtual));
      (Object.keys(flags) as (keyof Flags)[]).forEach((k) => { if (flags[k]) p.set(`f_${k}`, "1"); });
      const qs = p.toString();
      router.replace(qs ? `/produtos?${qs}` : "/produtos", { scroll: false });
    }, 300);
    return () => clearTimeout(t);
  }, [q, fTipo, fSub, fMarca, fFornecedorId, fStatus, sort, dir, porPagina, paginaAtual, flags, router]);

  const activeFilterCount =
    (q ? 1 : 0) + (fTipo ? 1 : 0) + (fSub ? 1 : 0) + (fMarca ? 1 : 0) +
    (fFornecedorId ? 1 : 0) + (fStatus !== "ativos" ? 1 : 0) +
    Object.values(flags).filter(Boolean).length;

  const clearFilters = useCallback(() => {
    setQ(""); setFTipo(""); setFSub(""); setFMarca("");
    setFFornecedorId(""); setFStatus("ativos"); setFlags(NO_FLAGS);
    resetPaging();
  }, [resetPaging]);

  function novo(tipo: "simples" | "insumo" | "combo" | "personalizado") { router.push(`/produtos/novo/${tipo}`); }
  function editar(p: ProductRow) { router.push(`/produtos/${p.id}/editar`); }
  function toggleInativo(p: ProductRow) {
    start(async () => { await archiveProduct(p.id, !p.ativo); router.refresh(); });
  }

  // ── Seleção ──
  const pageIds = paged.map((p) => p.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const somePageSelected = pageIds.some((id) => selected.has(id));
  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAllPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }
  function exportarSelecionados() {
    const escolhidos = rows.filter((p) => selected.has(p.id));
    exportCsv(escolhidos.length ? escolhidos : sorted);
  }

  // ── Imagens por código de barras ──
  const semImagem = rows.filter((p) => p.ativo && !p.imagemUrl);
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

  const temProdutos = rows.length > 0;
  /** Qualquer camada modal na tela (slide-over, sidepanel do produto, visualizador). */
  const painelAberto = sheet !== null || etiquetasOpen || !!selectedProduct || !!imageUrl;
  const cellPad = "py-1.5";
  const cozy = density === "cozy";

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
                <Button
                  variant="secondary"
                  size="sm"
                  className="gap-1.5"
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
              <MenuItem
                icon={<ImagePlus size={15} />}
                onClick={() => abrirImagens(semImagem)}
                disabled={semImagem.length === 0}
              >
                Buscar imagens{semImagem.length > 0 ? ` (${semImagem.length})` : ""}
              </MenuItem>
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
        {fFornecedorId && (
          <div className="mb-2 flex items-center gap-2 rounded-full border border-brand/30 bg-brand-soft px-3 py-1.5 text-xs font-medium text-brand-strong">
            <Truck size={13} />
            Filtrando por fornecedor: {initialFornecedorNome || "selecionado"}
            <button
              type="button"
              onClick={() => { setFFornecedorId(""); resetPaging(); }}
              className="ml-auto cursor-pointer rounded-full p-0.5 hover:bg-brand/15"
              aria-label="Remover filtro de fornecedor"
            >
              <X size={13} />
            </button>
          </div>
        )}
        {temProdutos && (
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-line bg-surface-2 p-2">
            <div className="relative min-w-48 flex-1">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
              <Input value={q} onChange={(e) => { setQ(e.target.value); resetPaging(); }} placeholder="Buscar nome, SKU ou código de barras" className="h-9 rounded-full border-line bg-surface pl-9" />
            </div>
            {cols.tipo && (
              <Select value={fTipo} onChange={(e) => { setFTipo(e.target.value); resetPaging(); }} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
                <option value="">Todos os tipos</option>
                <option value="SIMPLES">Simples</option>
                <option value="COMBO">Combo</option>
                <option value="PERSONALIZADO">Receita</option>
                <option value="INSUMO">Insumo</option>
              </Select>
            )}
            {cols.categoria && (
              <Select value={fSub} onChange={(e) => { setFSub(e.target.value); resetPaging(); }} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
                <option value="">Toda subcategoria</option>
                {subOpts.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </Select>
            )}
            {cols.marca && (
              <Select value={fMarca} onChange={(e) => { setFMarca(e.target.value); resetPaging(); }} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
                <option value="">Toda marca</option>
                {brandOpts.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
              </Select>
            )}
            <Select value={fStatus} onChange={(e) => { setFStatus(e.target.value); resetPaging(); }} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
              <option value="ativos">Ativos</option>
              <option value="inativos">Inativos</option>
              <option value="nao_arquivados">Não arquivados</option>
            </Select>

            {/* Mais filtros (booleanos de higiene/negócio) */}
            <Menu
              align="end"
              trigger={
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                    Object.values(flags).some(Boolean)
                      ? "border-brand/40 bg-brand-soft text-brand-strong"
                      : "border-line bg-surface text-ink-2 hover:bg-surface-2",
                  )}
                >
                  <SlidersHorizontal size={14} /> Mais filtros
                  {Object.values(flags).filter(Boolean).length > 0 && (
                    <span className="grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold text-on-brand">
                      {Object.values(flags).filter(Boolean).length}
                    </span>
                  )}
                </button>
              }
            >
              <div className="px-1 py-0.5">
                {(Object.keys(FLAG_LABEL) as (keyof Flags)[]).map((k) => (
                  <CheckRow
                    key={k}
                    checked={flags[k]}
                    label={FLAG_LABEL[k]}
                    onChange={() => { setFlags((f) => ({ ...f, [k]: !f[k] })); resetPaging(); }}
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
                      if (k === "tipo") { setFTipo(""); resetPaging(); }
                      if (k === "categoria") { setFSub(""); resetPaging(); }
                      if (k === "marca") { setFMarca(""); resetPaging(); }
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
                <DensityBtn active={density === "compact"} onClick={() => setDensity("compact")} icon={<Rows2 size={14} />}>Compacta</DensityBtn>
                <DensityBtn active={density === "cozy"} onClick={() => setDensity("cozy")} icon={<LayoutGrid size={14} />}>Card</DensityBtn>
              </div>
            </Menu>

            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <FilterX size={14} /> Limpar ({activeFilterCount})
              </button>
            )}
          </div>
        )}

        {!temProdutos ? (
          <EmptyState onNew={() => novo("simples")} onCsv={() => setSheet("csv")} />
        ) : sorted.length === 0 ? (
          <div className="mt-12 flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-muted">Nenhum produto bate com o filtro.</p>
            {activeFilterCount > 0 && (
              <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1.5">
                <FilterX size={15} /> Limpar filtros
              </Button>
            )}
          </div>
        ) : cozy ? (
          <>
            {/* ── Cards (densidade confortável — todas as telas) ── */}
            <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {paged.map((p) => (
                <ProductCard
                  key={p.id}
                  p={p}
                  big
                  cols={cols}
                  info={info}
                  selected={selected.has(p.id)}
                  onToggle={() => toggleRow(p.id)}
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
            {/* ── Tabela (md+) ── */}
            <div className="mt-4 hidden rounded-[var(--radius-lg)] border border-line bg-surface md:block">
              <table className="w-full text-left">
                <thead className="border-b border-line bg-surface-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
                  <tr>
                    <th className="w-10 px-3 py-2.5">
                      <Check
                        checked={allPageSelected}
                        indeterminate={!allPageSelected && somePageSelected}
                        onChange={toggleAllPage}
                        label="Selecionar todos desta página"
                      />
                    </th>
                    <SortableTh label="Produto" field="nome" sort={sort} dir={dir} onSort={toggleSort} />
                    {cols.marca && <SortableTh label="Marca" field="marca" sort={sort} dir={dir} onSort={toggleSort} className="hidden xl:table-cell" />}
                    {cols.tipo && <SortableTh label="Tipo" field="tipo" sort={sort} dir={dir} onSort={toggleSort} className="hidden lg:table-cell" />}
                    {cols.categoria && <SortableTh label="Categoria" field="categoria" sort={sort} dir={dir} onSort={toggleSort} className="hidden lg:table-cell" />}
                    <SortableTh label="Preço" field="preco" sort={sort} dir={dir} onSort={toggleSort} />
                    {cols.margem && <SortableTh label="Margem" field="margem" sort={sort} dir={dir} onSort={toggleSort} className="hidden sm:table-cell" />}
                    {cols.fornecedor && <SortableTh label="Fornecedor" field="fornecedor" sort={sort} dir={dir} onSort={toggleSort} className="hidden md:table-cell" />}
                    {cols.estoque && <SortableTh label="Estoque" field="estoque" sort={sort} dir={dir} onSort={toggleSort} />}
                    <th className="w-10 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {paged.map((p) => {
                    const level = stockLevel(p);
                    const principal = principalFornecedor(p);
                    const isSel = selected.has(p.id);
                    return (
                      <tr
                        key={p.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Abrir ${p.nome}`}
                        onClick={() => setSelectedProduct(p)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedProduct(p); }
                        }}
                        className={cn(
                          "group relative cursor-pointer outline-none transition-colors hover:bg-brand-soft/30 focus-visible:bg-brand-soft/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                          isSel && "bg-brand-soft/40",
                          !p.ativo && "opacity-50",
                        )}
                      >
                        <td className={cn("px-3", cellPad)} onClick={(e) => e.stopPropagation()}>
                          <Check checked={isSel} onChange={() => toggleRow(p.id)} label={`Selecionar ${p.nome}`} />
                        </td>

                        {/* Produto */}
                        <td className={cn("px-4", cellPad)}>
                          <div className="flex items-center gap-3">
                            <Thumb
                              url={p.imagemUrl}
                              tipo={p.tipo}
                              onClickImage={p.imagemUrl ? () => setImageUrl(p.imagemUrl) : undefined}
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-[13px] font-semibold text-ink leading-snug">{p.nome}</span>
                                {p.vendeOnline && (
                                  <Globe size={12} className="shrink-0 text-brand" aria-label="Vende online" />
                                )}
                                {info.restricao && p.restricaoIdade && (
                                  <span className="inline-flex items-center rounded-full border border-danger/30 bg-danger/10 px-1 py-px text-[9px] font-bold text-danger">+18</span>
                                )}
                              </div>
                              <BarcodeCell sku={p.sku} ean={p.ean} packagings={p.packagings} showSku={info.sku} />
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
                            <div className="mt-0.5 text-[11px] text-faint">{p.categoriaNome}</div>
                          </td>
                        )}

                        {/* Preço */}
                        <td className={cn("px-4", cellPad)}>
                          <PriceCell tipo={p.tipo} precoVenda={p.precoVenda} custo={p.custo} />
                        </td>

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
              {paged.map((p) => (
                <ProductCard
                  key={p.id}
                  p={p}
                  cols={cols}
                  info={info}
                  selected={selected.has(p.id)}
                  onToggle={() => toggleRow(p.id)}
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

        {/* ── Paginação ── */}
        {temProdutos && sorted.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-2 text-xs text-faint">
              <span>
                {inicio + 1}–{Math.min(inicio + porPagina, sorted.length)} de {sorted.length}
                {rows.length !== sorted.length ? ` (${rows.length} no total)` : ""}
              </span>
              <span className="text-line">·</span>
              <label className="flex items-center gap-1.5">
                Exibir
                <select
                  value={porPagina}
                  onChange={(e) => { setPorPagina(Number(e.target.value)); resetPaging(); }}
                  className="h-7 cursor-pointer appearance-none rounded-lg border border-line bg-surface px-2 text-xs font-medium text-ink focus:border-brand focus:outline-none"
                >
                  {POR_PAGINA.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                por página
              </label>
            </div>

            {totalPaginas > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPagina((p) => Math.max(1, p - 1))}
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
                  onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
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
            ? <CategorySheet open onClose={() => setSheet(null)} tree={extras.categoryTree} />
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
      </div>

      {/* ── Barra de ações em lote ──
          Some enquanto um painel está aberto: ela é `fixed` no rodapé e, vindo
          depois no DOM, ficava por cima do rodapé do slide-over — engolindo o
          botão de salvar do painel que ela mesma abriu. */}
      {selected.size > 0 && !painelAberto && (
        <BulkBar
          count={selected.size}
          onEtiquetas={() => setEtiquetasOpen(true)}
          onExportar={exportarSelecionados}
          onImagens={() => abrirImagens(rows.filter((p) => selected.has(p.id)))}
          onLimpar={() => setSelected(new Set())}
        />
      )}

      {etiquetasOpen && (
        <EtiquetasSheet
          open
          onClose={() => setEtiquetasOpen(false)}
          products={rows.filter((p) => selected.has(p.id))}
        />
      )}

      {selectedProduct && (
        <ProductSidePanel
          key={selectedProduct.id}
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onEdit={() => router.push(`/produtos/${selectedProduct.id}/editar`)}
        />
      )}

      {imageUrl && <ImageViewer url={imageUrl} onClose={() => setImageUrl(null)} />}
    </>
  );
}

// ── Cabeçalho ordenável ───────────────────────────────────────────────────────

function SortableTh({
  label, field, sort, dir, onSort, className,
}: {
  label: string;
  field: SortField;
  sort: SortField;
  dir: SortDir;
  onSort: (f: SortField) => void;
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

// ── Checkbox (com estado indeterminado) ──────────────────────────────────────

function Check({
  checked, indeterminate, onChange, label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate; }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      aria-label={label}
      className="h-4 w-4 cursor-pointer rounded border-line accent-[var(--color-brand)]"
    />
  );
}

function CheckRow({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-sm text-ink transition-colors hover:bg-surface-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 cursor-pointer rounded border-line accent-[var(--color-brand)]"
      />
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
  count, onEtiquetas, onExportar, onImagens, onLimpar,
}: {
  count: number;
  onEtiquetas: () => void;
  onExportar: () => void;
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
        <Button size="sm" onClick={onEtiquetas} className="gap-1.5">
          <Printer size={15} /> Imprimir etiquetas
        </Button>
        <Button variant="ghost" size="sm" onClick={onImagens} className="gap-1.5">
          <ImagePlus size={15} /> Buscar imagens
        </Button>
        <Button variant="ghost" size="sm" onClick={onExportar} className="gap-1.5">
          <Download size={15} /> Exportar
        </Button>
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
 * Card de produto — usado no mobile (sempre) e na densidade "Confortável"
 * (grid em todas as telas). `big` deixa o card mais espaçoso e mostra
 * categoria/tipo, que não cabem na versão compacta do mobile.
 */
function ProductCard({
  p, selected, onToggle, onOpen, onImage, onEdit, onArchive, onBuscarImagem, big, cols, info,
}: {
  p: ProductRow;
  selected: boolean;
  onToggle: () => void;
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

function csvCell(v: string | number | null): string {
  if (v == null) return "";
  const s = String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(rows: ProductRow[]) {
  const header = ["Nome", "SKU", "EAN", "Tipo", "Marca", "Categoria", "Subcategoria", "Preço", "Custo", "Margem %", "Estoque", "Fornecedor", "Ativo"];
  const lines = rows.map((p) => {
    const m = margem(p.precoVenda, p.custo);
    const qty = stockQty(p);
    return [
      p.nome, p.sku, p.ean, TIPO_LABEL[p.tipo] ?? p.tipo, p.marca,
      p.categoriaNome, p.subcategoriaNome,
      p.precoVenda != null ? p.precoVenda.toFixed(2).replace(".", ",") : "",
      p.custo != null ? p.custo.toFixed(2).replace(".", ",") : "",
      m != null ? String(m) : "",
      qty != null ? String(qty) : "",
      principalFornecedor(p)?.nome ?? "",
      p.ativo ? "Sim" : "Não",
    ].map(csvCell).join(";");
  });
  const csv = "﻿" + [header.join(";"), ...lines].join("\r\n");
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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="h-full w-full object-cover" />
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

  // Medidor: saldo fechado × meta ideal.
  const pct = p.estoque.ideal > 0 && qty !== null
    ? Math.max(0, Math.min(100, Math.round((qty / p.estoque.ideal) * 100)))
    : null;

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
        {pct !== null && (
          <span className="h-1 w-16 overflow-hidden rounded-full bg-line" aria-hidden>
            <span className={cn("block h-full rounded-full", STOCK_COLOR[level])} style={{ width: `${pct}%` }} />
          </span>
        )}
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

// ── Célula de preço com tooltip (custo × venda) ──────────────────────────────

function PriceCell({ tipo, precoVenda, custo }: { tipo: string; precoVenda: number | null; custo: number | null }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);

  if (tipo === "INSUMO") return <span className="text-[11px] text-faint">uso interno</span>;

  const hasBoth = precoVenda != null && custo != null;

  function handleEnter() {
    if (!hasBoth) return;
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.top + window.scrollY, left: rect.left + window.scrollX });
    setShow(true);
  }

  return (
    <>
      <div
        ref={ref}
        className={cn(hasBoth && "cursor-help")}
        onMouseEnter={handleEnter}
        onMouseLeave={() => setShow(false)}
      >
        {precoVenda != null
          ? <span className="font-mono text-[13px] font-medium text-ink tnum">{brl(precoVenda)}</span>
          : <span className="text-[11px] font-medium text-warn">Sem preço</span>}
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
