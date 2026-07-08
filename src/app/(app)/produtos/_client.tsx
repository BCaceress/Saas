"use client";

import { useMemo, useState, useTransition, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Plus, Tag, FolderTree, Warehouse, Truck, Upload, Search, Settings2,
  Pencil, PackageOpen, Wine, ChevronDown, Boxes, Sparkles,
  MoreVertical, Percent, EyeOff, Eye, X,
  Barcode, Hash, ChevronLeft, ChevronRight,
} from "lucide-react";
import { cn, brl, margem } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/app/page-header";
import {
  ProductSidePanel, stockLevel, TIPO_LABEL, TIPO_ICON, STOCK_COLOR, STOCK_TITLE, STOCK_TEXT,
} from "@/components/app/product-side-panel";
import { BrandSheet, CategorySheet, StorageSheet, SupplierSheet } from "./_sheets/sidepanels";
import { CsvSheet } from "./_sheets/csv-sheet";
import { archiveProduct } from "./actions";
import type {
  ProductRow, CategoryNode, BrandOpt, SubcategoryOpt, StorageOpt, SupplierRow,
  ProductPackagingItem,
} from "./_types";

type SheetKind = null | "brand" | "category" | "storage" | "supplier" | "csv";

const POR_PAGINA = [25, 50, 100, 200];

export function ProdutosClient(props: {
  rows: ProductRow[];
  categoryTree: CategoryNode[];
  subOpts: SubcategoryOpt[];
  brandOpts: BrandOpt[];
  storageOpts: StorageOpt[];
  supplierRows: SupplierRow[];
  siteOpts: { id: string; nome: string }[];
}) {
  const { rows, categoryTree, subOpts, brandOpts, storageOpts, supplierRows, siteOpts } = props;
  const router = useRouter();
  const [, start] = useTransition();

  const [sheet, setSheet] = useState<SheetKind>(null);
  const [selectedProduct, setSelectedProduct] = useState<ProductRow | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fSub, setFSub] = useState("");
  const [fMarca, setFMarca] = useState("");
  const [fStatus, setFStatus] = useState("ativos");
  const [porPagina, setPorPagina] = useState(50);
  const [pagina, setPagina] = useState(1);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((p) => {
      if (term && !`${p.nome} ${p.sku} ${p.ean ?? ""}`.toLowerCase().includes(term)) return false;
      if (fTipo && p.tipo !== fTipo) return false;
      if (fSub && p.subcategoryId !== fSub) return false;
      if (fMarca && p.brandId !== fMarca) return false;
      if (fStatus === "ativos" && !p.ativo) return false;
      if (fStatus === "arquivados" && p.ativo) return false;
      return true;
    });
  }, [rows, q, fTipo, fSub, fMarca, fStatus]);

  // Volta pra primeira página quando filtro/tamanho muda
  useEffect(() => {
    setPagina(1);
  }, [q, fTipo, fSub, fMarca, fStatus, porPagina]);

  const totalPaginas = Math.max(1, Math.ceil(filtered.length / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicio = (paginaAtual - 1) * porPagina;
  const paged = filtered.slice(inicio, inicio + porPagina);

  function novo(tipo: "simples" | "insumo" | "combo" | "personalizado") { router.push(`/produtos/novo/${tipo}`); }
  function editar(p: ProductRow) { router.push(`/produtos/${p.id}/editar`); }
  function toggleInativo(p: ProductRow) {
    start(async () => { await archiveProduct(p.id, !p.ativo); router.refresh(); });
  }

  const temProdutos = rows.length > 0;

  return (
    <>
      <PageHeader
        title="Produtos"
        innerClassName="max-w-none"
        actions={
          <>
            <Menu
              align="end"
              trigger={
                <Button variant="secondary" size="sm" className="gap-1.5">
                  <Settings2 size={15} /> Gerenciar
                  <ChevronDown size={14} className="-mr-0.5 text-muted" />
                </Button>
              }
            >
              <MenuItem icon={<Tag size={15} />} onClick={() => setSheet("brand")}>Marcas</MenuItem>
              <MenuItem icon={<FolderTree size={15} />} onClick={() => setSheet("category")}>Categorias</MenuItem>
              <MenuItem icon={<Warehouse size={15} />} onClick={() => setSheet("storage")}>Armazenagem</MenuItem>
              <MenuItem icon={<Truck size={15} />} onClick={() => setSheet("supplier")}>Fornecedores</MenuItem>
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
                <MenuItem icon={<Sparkles size={15} />} onClick={() => novo("personalizado")}>Personalizado</MenuItem>
                <MenuItem icon={<PackageOpen size={15} />} onClick={() => novo("insumo")}>Insumo</MenuItem>
              </Menu>
            </div>
          </>
        }
      />

      <div className="w-full rounded-[var(--radius-lg)] bg-surface p-3 shadow-[var(--shadow-float)] sm:p-4">
        {temProdutos && (
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-line bg-surface-2 p-2">
            <div className="relative min-w-56 flex-1">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nome, SKU ou código de barras" className="h-9 rounded-full border-line bg-surface pl-9" />
            </div>
            <Select value={fTipo} onChange={(e) => setFTipo(e.target.value)} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
              <option value="">Todos os tipos</option>
              <option value="SIMPLES">Simples</option>
              <option value="COMBO">Combo</option>
              <option value="PERSONALIZADO">Receita</option>
              <option value="INSUMO">Insumo</option>
            </Select>
            <Select value={fSub} onChange={(e) => setFSub(e.target.value)} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
              <option value="">Toda subcategoria</option>
              {subOpts.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </Select>
            <Select value={fMarca} onChange={(e) => setFMarca(e.target.value)} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
              <option value="">Toda marca</option>
              {brandOpts.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
            </Select>
            <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} containerClassName="w-auto" className="h-9 rounded-full bg-surface">
              <option value="ativos">Ativos</option>
              <option value="arquivados">Arquivados</option>
              <option value="todos">Todos</option>
            </Select>
          </div>
        )}

        {!temProdutos ? (
          <EmptyState onNew={() => novo("simples")} onCsv={() => setSheet("csv")} />
        ) : filtered.length === 0 ? (
          <p className="mt-12 text-center text-sm text-muted">Nenhum produto bate com o filtro.</p>
        ) : (
          <div className="mt-4 rounded-[var(--radius-lg)] border border-line bg-surface">
            <table className="w-full text-left">
              <thead className="border-b border-line bg-surface-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
                <tr>
                  <th className="px-4 py-2.5">Produto</th>
                  <th className="hidden px-4 py-2.5 xl:table-cell">Marca</th>
                  <th className="hidden px-4 py-2.5 lg:table-cell">Tipo</th>
                  <th className="hidden px-4 py-2.5 lg:table-cell">Categoria</th>
                  <th className="px-4 py-2.5">Preço</th>
                  <th className="hidden px-4 py-2.5 md:table-cell">Fornecedor</th>
                  <th className="px-4 py-2.5">Estoque</th>
                  <th className="w-10 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {paged.map((p) => {
                  const level = stockLevel(p);
                  const principal = p.fornecedores.find((f) => f.isPrincipal) ?? p.fornecedores[0];
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setSelectedProduct(p)}
                      className={cn(
                        "group relative cursor-pointer transition-colors hover:bg-brand-soft/30",
                        !p.ativo && "opacity-50",
                      )}
                    >
                      {/* Produto */}
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          <Thumb
                            url={p.imagemUrl}
                            tipo={p.tipo}
                            onClickImage={p.imagemUrl ? () => setImageUrl(p.imagemUrl) : undefined}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-[13px] font-semibold text-ink leading-snug">{p.nome}</span>
                              {p.restricaoIdade && (
                                <span className="inline-flex items-center rounded-full border border-danger/30 bg-danger/10 px-1 py-px text-[9px] font-bold text-danger">+18</span>
                              )}
                            </div>
                            <BarcodeCell sku={p.sku} ean={p.ean} packagings={p.packagings} />
                          </div>
                        </div>
                      </td>

                      {/* Marca */}
                      <td className="hidden px-4 py-2 xl:table-cell">
                        {p.marca ? (
                          <span className="text-[12px] text-ink-2">{p.marca}</span>
                        ) : (
                          <span className="text-[11px] text-faint">—</span>
                        )}
                      </td>

                      {/* Tipo */}
                      <td className="hidden px-4 py-2 lg:table-cell">
                        <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
                          <span className="text-faint">{TIPO_ICON[p.tipo]}</span>
                          {TIPO_LABEL[p.tipo]}
                        </span>
                      </td>

                      {/* Categoria */}
                      <td className="hidden px-4 py-2 lg:table-cell">
                        <div className="text-[13px] font-medium text-ink-2">{p.subcategoriaNome}</div>
                        <div className="mt-0.5 text-[11px] text-faint">{p.categoriaNome}</div>
                      </td>

                      {/* Preço */}
                      <td className="px-4 py-2">
                        <PriceCell tipo={p.tipo} precoVenda={p.precoVenda} custo={p.custo} />
                      </td>

                      {/* Fornecedor */}
                      <td className="hidden px-4 py-2 md:table-cell">
                        {principal ? (
                          <span className="text-[12px] text-ink-2 leading-snug">{principal.nome}</span>
                        ) : (
                          <span className="text-[11px] text-faint">—</span>
                        )}
                      </td>

                      {/* Estoque */}
                      <td className="px-4 py-2">
                        <StockCell p={p} level={level} />
                      </td>

                      {/* Ações */}
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
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
                            <MenuItem icon={<Percent size={15} />} onClick={() => editar(p)}>Promoção</MenuItem>
                            <MenuItem icon={<Pencil size={15} />} onClick={() => editar(p)}>Editar</MenuItem>
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
        )}

        {/* ── Paginação ── */}
        {temProdutos && filtered.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-2 text-xs text-faint">
              <span>
                {inicio + 1}–{Math.min(inicio + porPagina, filtered.length)} de {filtered.length}
                {rows.length !== filtered.length ? ` (${rows.length} no total)` : ""}
              </span>
              <span className="text-line">·</span>
              <label className="flex items-center gap-1.5">
                Exibir
                <select
                  value={porPagina}
                  onChange={(e) => setPorPagina(Number(e.target.value))}
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
        {sheet === "category" && <CategorySheet open onClose={() => setSheet(null)} tree={categoryTree} />}
        {sheet === "storage" && <StorageSheet open onClose={() => setSheet(null)} locations={storageOpts} sites={siteOpts} />}
        {sheet === "supplier" && <SupplierSheet open onClose={() => setSheet(null)} suppliers={supplierRows} />}
        {sheet === "csv" && <CsvSheet open onClose={() => setSheet(null)} />}
      </div>

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

// ── Thumb com hover e clique ──────────────────────────────────────────────────

function Thumb({
  url, tipo, onClickImage,
}: {
  url: string | null;
  tipo: string;
  onClickImage?: () => void;
}) {
  if (url) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClickImage?.(); }}
        className="relative h-9 w-9 shrink-0 cursor-zoom-in overflow-hidden rounded-[var(--radius-sm)] border border-line group/img"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="h-full w-full object-cover" />
        <span className="absolute inset-0 grid place-items-center bg-ink/25 opacity-0 transition-opacity group-hover/img:opacity-100">
          <Eye size={13} className="text-white drop-shadow" />
        </span>
      </button>
    );
  }
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface-2 text-faint">
      {tipo === "INSUMO" ? <PackageOpen size={15} /> : <Wine size={15} />}
    </span>
  );
}

// ── Célula de códigos de barra com tooltip portal ────────────────────────────

function BarcodeCell({
  sku, ean, packagings,
}: {
  sku: string;
  ean: string | null;
  packagings: ProductPackagingItem[];
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
        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-2">
          <Hash size={10} className="shrink-0 text-muted" />
          {sku}
        </span>
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

// ── Célula de preço com tooltip (custo × venda) ──────────────────────────────

function StockCell({ p, level }: { p: ProductRow; level: "ok" | "warn" | "danger" }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);

  // Personalizado (feito na hora) e insumo sem mínimo/ideal não têm controle de estoque.
  const semControle =
    p.tipo === "PERSONALIZADO" ||
    (p.tipo === "INSUMO" && p.estoque.minimo <= 0 && p.estoque.ideal <= 0);

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

  function handleEnter() {
    if (!hasDetail) return;
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.top + window.scrollY, left: rect.left + window.scrollX });
    setShow(true);
  }

  if (semControle) {
    return <span className="text-[12px] text-muted">Sem controle de estoque</span>;
  }

  return (
    <>
      <div
        ref={ref}
        className={cn("inline-flex", hasDetail && "cursor-help")}
        onMouseEnter={handleEnter}
        onMouseLeave={() => setShow(false)}
      >
        <span className={cn("inline-flex items-center gap-1.5 text-[12px] font-medium", STOCK_TEXT[level])}>
          <span className={cn("h-2 w-2 shrink-0 rounded-full", STOCK_COLOR[level])} />
          {STOCK_TITLE[level]}
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
          <ul className="space-y-1.5">
            {lojas.map((l, i) => (
              <li key={i} className="flex items-center justify-between gap-3 text-[12px]">
                <span className="min-w-0 truncate text-ink-2">{l.siteNome}</span>
                <span className="shrink-0 font-mono font-medium text-ink tnum">
                  {l.fechado} unidade{l.fechado === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}

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
        <span className="font-mono text-[13px] font-medium text-ink tnum">{brl(precoVenda)}</span>
        {margem(precoVenda, custo) !== null && (
          <div className="mt-0.5 text-[11px] font-medium text-ok">{margem(precoVenda, custo)}% margem</div>
        )}
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
                <span className="font-mono font-medium text-ok tnum">{margem(precoVenda, custo)}%</span>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
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
