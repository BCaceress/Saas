"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Tag, FolderTree, Warehouse, Truck, Upload, Search, Settings2,
  Pencil, PackageOpen, Wine, ChevronDown, Boxes, Sparkles,
  MoreVertical, Percent, EyeOff, Eye, CircleDashed,
} from "lucide-react";
import { cn, brl, margem } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/misc";
import { PageHeader } from "@/components/app/page-header";
import { SkuTag } from "@/components/sku-tag";
import { StockGauge } from "@/components/stock-gauge";
import { BrandSheet, CategorySheet, StorageSheet, SupplierSheet } from "./_sheets/sidepanels";
import { CsvSheet } from "./_sheets/csv-sheet";
import { archiveProduct } from "./actions";
import type {
  ProductRow, CategoryNode, BrandOpt, SubcategoryOpt, StorageOpt, SupplierRow,
} from "./_types";

type SheetKind = null | "brand" | "category" | "storage" | "supplier" | "csv";

const TIPO_LABEL: Record<string, string> = {
  SIMPLES: "Simples", INSUMO: "Insumo", COMBO: "Combo", PERSONALIZADO: "Receita",
};

export function ProdutosClient(props: {
  rows: ProductRow[];
  categoryTree: CategoryNode[];
  subOpts: SubcategoryOpt[];
  brandOpts: BrandOpt[];
  storageOpts: StorageOpt[];
  supplierRows: SupplierRow[];
}) {
  const { rows, categoryTree, subOpts, brandOpts, storageOpts, supplierRows } = props;
  const router = useRouter();
  const [, start] = useTransition();

  const [sheet, setSheet] = useState<SheetKind>(null);

  const [q, setQ] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fSub, setFSub] = useState("");
  const [fMarca, setFMarca] = useState("");
  const [fStatus, setFStatus] = useState("ativos");

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

  function novo(tipo: "simples" | "insumo" | "combo" | "personalizado") { router.push(`/produtos/novo/${tipo}`); }
  function editar(p: ProductRow) { router.push(`/produtos/${p.id}/editar`); }
  function promocao(p: ProductRow) { router.push(`/produtos/${p.id}/editar`); }
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
            {/* Cadastros auxiliares — agrupados num só menu para reduzir ruído */}
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

            {/* Ação primária — botão dividido: criar simples direto + escolher tipo */}
            <div className="inline-flex shadow-[var(--shadow-1)] rounded-full">
              <Button size="sm" onClick={() => novo("simples")} className="gap-1.5 rounded-r-none shadow-none"><Plus size={15} /> Novo produto</Button>
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
        <div className="mt-4 overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
          <table className="w-full text-left">
            <thead className="border-b border-line bg-surface-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
              <tr>
                <th className="px-5 py-3">Produto</th>
                <th className="hidden px-4 py-3 lg:table-cell">Categoria</th>
                <th className="px-4 py-3">Preço</th>
                <th className="hidden px-4 py-3 xl:table-cell">Estoque</th>
                <th className="hidden px-4 py-3 sm:table-cell">Status</th>
                <th className="w-12 px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  className={cn(
                    "group relative transition-colors hover:bg-brand-soft/30",
                    !p.ativo && "opacity-50",
                  )}
                >
                  {/* Produto */}
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <Thumb url={p.imagemUrl} tipo={p.tipo} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-semibold text-ink leading-snug">{p.nome}</span>
                          {p.restricaoIdade && <Badge tone="danger">+18</Badge>}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <SkuTag sku={p.sku} />
                          {p.marca && <span className="text-[11px] text-faint">{p.marca}</span>}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Categoria */}
                  <td className="hidden px-4 py-3.5 lg:table-cell">
                    <div className="text-[13px] text-ink-2">{p.subcategoriaNome}</div>
                    <div className="mt-0.5 text-[11px] text-faint">{TIPO_LABEL[p.tipo]}</div>
                  </td>

                  {/* Preço */}
                  <td className="px-4 py-3.5">
                    {p.tipo === "INSUMO" ? (
                      <span className="text-[11px] text-faint">uso interno</span>
                    ) : (
                      <>
                        <span className="font-mono text-[13px] font-medium text-ink tnum">{brl(p.precoVenda)}</span>
                        {margem(p.precoVenda, p.custo) !== null && (
                          <div className="mt-0.5 text-[11px] font-medium text-ok">{margem(p.precoVenda, p.custo)}% margem</div>
                        )}
                      </>
                    )}
                  </td>

                  {/* Estoque */}
                  <td className="hidden px-4 py-3.5 xl:table-cell">
                    {p.disponibilidadeDerivada !== null ? (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 font-mono text-[13px] font-medium tnum",
                          p.disponibilidadeDerivada > 0 ? "text-ink-2" : "text-danger",
                        )}
                        title="Montáveis com o estoque dos componentes"
                      >
                        <Boxes size={14} className="text-faint" />
                        {p.disponibilidadeDerivada}
                        <span className="text-[11px] font-normal text-faint">montáveis</span>
                      </span>
                    ) : p.tipo === "INSUMO" && p.estoque.minimo === 0 && p.estoque.ideal === 0 ? (
                      <span
                        className="inline-flex items-center gap-1.5 text-[11px] text-faint"
                        title="Estoque não controlado"
                      >
                        <CircleDashed size={13} />
                        Sem controle
                      </span>
                    ) : (
                      <StockGauge
                        fechado={p.estoque.fechado}
                        aberto={p.estoque.aberto}
                        minimo={p.estoque.minimo}
                        ideal={p.estoque.ideal}
                        conteudoPorUnidade={p.conteudoPorUnidade}
                        fracionavel={p.fracionavel}
                        unidade={p.unidadeBase}
                      />
                    )}
                  </td>

                  {/* Status */}
                  <td className="hidden px-4 py-3.5 sm:table-cell">
                    {p.ativo ? (
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ok">
                        <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                        Ativo
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted">
                        <span className="h-1.5 w-1.5 rounded-full bg-muted" />
                        Inativo
                      </span>
                    )}
                  </td>

                  {/* Ações */}
                  <td className="px-3 py-3.5">
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
                        <MenuItem icon={<Percent size={15} />} onClick={() => promocao(p)}>
                          Promoção
                        </MenuItem>
                        <MenuItem icon={<Pencil size={15} />} onClick={() => editar(p)}>
                          Editar
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
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sheet === "brand" && <BrandSheet open onClose={() => setSheet(null)} brands={brandOpts} />}
      {sheet === "category" && <CategorySheet open onClose={() => setSheet(null)} tree={categoryTree} />}
      {sheet === "storage" && <StorageSheet open onClose={() => setSheet(null)} locations={storageOpts} />}
      {sheet === "supplier" && <SupplierSheet open onClose={() => setSheet(null)} suppliers={supplierRows} />}
      {sheet === "csv" && <CsvSheet open onClose={() => setSheet(null)} />}
      </div>
    </>
  );
}

function Thumb({ url, tipo }: { url: string | null; tipo: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="h-10 w-10 shrink-0 rounded-[var(--radius-sm)] border border-line object-cover" />;
  }
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface-2 text-faint">
      {tipo === "INSUMO" ? <PackageOpen size={16} /> : <Wine size={16} />}
    </span>
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
