"use client";

import { useMemo, useState } from "react";
import { Printer, Tag, Boxes, Check } from "lucide-react";
import { cn, brl } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Select } from "@/components/ui/input";
import type { ProductRow } from "../_types";

type Modelo = "gondola" | "distribuidora";
type Papel = "58" | "80" | "a4";
type Flags = { sku: boolean; barcode: boolean; marca: boolean; preco: boolean };

const PAPEL_LABEL: Record<Papel, string> = {
  "58": "Etiqueta 58 mm",
  "80": "Etiqueta 80 mm",
  a4: "A4 (folha de etiquetas)",
};

/** Volume legível a partir de conteúdo/unidade base (ex.: 500ml, 250g). UN → sem volume. */
function formatVolume(p: ProductRow): string | null {
  if (p.conteudoPorUnidade == null) return null;
  const u = p.unidadeBase === "ML" ? "ml" : p.unidadeBase === "G" ? "g" : "";
  return u ? `${p.conteudoPorUnidade}${u}` : null;
}

/** Barras ilustrativas determinísticas a partir dos dígitos do código. */
function genBars(codeRaw: string | null): { w: number; on: boolean }[] {
  const code = (codeRaw ?? "").replace(/\D/g, "") || "000000000000";
  const bars: { w: number; on: boolean }[] = [];
  for (const ch of code) {
    const d = Number(ch);
    bars.push({ w: 1 + (d % 3), on: true });
    bars.push({ w: 1 + ((d + 1) % 3), on: false });
  }
  return bars;
}

function escHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

// ── Prévia (React) ────────────────────────────────────────────────────────────

function BarcodeBars({ code }: { code: string | null }) {
  const bars = useMemo(() => genBars(code), [code]);
  return (
    <div className="flex h-10 items-stretch justify-center" aria-hidden>
      {bars.map((b, i) => (
        <span key={i} style={{ width: `${b.w}px` }} className={b.on ? "bg-ink" : "bg-transparent"} />
      ))}
    </div>
  );
}

function LabelPreview({ p, modelo, flags }: { p: ProductRow; modelo: Modelo; flags: Flags }) {
  const vol = formatVolume(p);
  return (
    <div className="mx-auto w-full max-w-64 rounded-[var(--radius)] border border-line bg-white px-4 py-3 text-center text-ink shadow-sm">
      <div className="font-display text-sm font-bold uppercase leading-tight">{p.nome}</div>

      {modelo === "gondola" ? (
        <>
          {vol && <div className="mt-0.5 text-[11px] text-muted">{vol}</div>}
          {flags.marca && p.marca && (
            <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">{p.marca}</div>
          )}
          {flags.preco && (
            <div className="my-1.5 font-display text-2xl font-extrabold tnum">{brl(p.precoVenda)}</div>
          )}
          {flags.barcode && p.ean && (
            <>
              <div className="mt-1.5"><BarcodeBars code={p.ean} /></div>
              <div className="font-mono text-[10px] tracking-widest text-ink-2">{p.ean}</div>
            </>
          )}
          {flags.sku && <div className="mt-1 font-mono text-[10px] text-muted">{p.sku}</div>}
        </>
      ) : (
        <>
          {flags.marca && p.marca && (
            <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">{p.marca}</div>
          )}
          {flags.sku && (
            <div className="mt-1.5 font-mono text-xs text-ink-2">
              <span className="text-muted">SKU: </span>{p.sku}
            </div>
          )}
          {flags.barcode && p.ean && (
            <>
              <div className="mt-1.5"><BarcodeBars code={p.ean} /></div>
              <div className="font-mono text-[10px] tracking-widest text-ink-2">{p.ean}</div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Impressão (janela nova, HTML autocontido) ────────────────────────────────

function labelHtml(p: ProductRow, modelo: Modelo, flags: Flags): string {
  const vol = formatVolume(p);
  const bars = genBars(p.ean)
    .map((b) => `<span style="display:inline-block;width:${b.w}px;height:100%;background:${b.on ? "#000" : "transparent"}"></span>`)
    .join("");
  const barBlock = flags.barcode && p.ean
    ? `<div class="l-bars">${bars}</div><div class="l-code">${escHtml(p.ean)}</div>`
    : "";
  const marca = flags.marca && p.marca ? `<div class="l-marca">${escHtml(p.marca)}</div>` : "";

  if (modelo === "gondola") {
    return `<div class="label">
      <div class="l-nome">${escHtml(p.nome)}</div>
      ${vol ? `<div class="l-vol">${escHtml(vol)}</div>` : ""}
      ${marca}
      ${flags.preco ? `<div class="l-preco">${brl(p.precoVenda)}</div>` : ""}
      ${barBlock}
      ${flags.sku ? `<div class="l-sku">${escHtml(p.sku)}</div>` : ""}
    </div>`;
  }
  return `<div class="label">
    <div class="l-nome">${escHtml(p.nome)}</div>
    ${marca}
    ${flags.sku ? `<div class="l-sku">SKU: ${escHtml(p.sku)}</div>` : ""}
    ${barBlock}
  </div>`;
}

function printLabels(products: ProductRow[], modelo: Modelo, papel: Papel, flags: Flags, perQty: number) {
  const paper = papel === "a4" ? "A4" : `${papel}mm auto`;
  const labelWidth = papel === "58" ? "54mm" : papel === "80" ? "76mm" : "50mm";
  const css = `
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { size: ${paper}; margin: ${papel === "a4" ? "8mm" : "2mm"}; }
    body { font-family: 'IBM Plex Sans', Arial, sans-serif; margin: 0; ${papel === "a4" ? "display:flex; flex-wrap:wrap; gap:4mm; align-content:flex-start;" : ""} }
    .label { width: ${labelWidth}; padding: 3mm; border: 1px solid #222; border-radius: 2mm; ${papel === "a4" ? "" : "margin:0 auto 4mm;"} page-break-inside: avoid; text-align: center; color:#000; }
    .l-nome { font-weight: 700; font-size: 11pt; line-height: 1.15; text-transform: uppercase; }
    .l-vol { font-size: 8pt; color: #555; margin-top: 0.5mm; }
    .l-marca { font-size: 7.5pt; color: #555; text-transform: uppercase; letter-spacing: .04em; margin-top: 0.5mm; }
    .l-preco { font-weight: 800; font-size: 20pt; margin: 1.5mm 0; }
    .l-bars { height: 12mm; display: flex; align-items: stretch; justify-content: center; margin: 1.5mm 0 0.5mm; }
    .l-code { font-family: 'IBM Plex Mono', monospace; font-size: 8pt; letter-spacing: .1em; }
    .l-sku { font-family: 'IBM Plex Mono', monospace; font-size: 8pt; color: #333; margin-top: 1mm; }
  `;
  const body = products
    .flatMap((p) => Array.from({ length: perQty }, () => labelHtml(p, modelo, flags)))
    .join("");

  const win = window.open("", "_blank", "width=460,height=680");
  if (!win) return;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas</title><style>${css}</style></head><body>${body}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 350);
}

// ── Side Panel ────────────────────────────────────────────────────────────────

export function EtiquetasSheet({
  open, onClose, products,
}: {
  open: boolean;
  onClose: () => void;
  products: ProductRow[];
}) {
  const [modelo, setModelo] = useState<Modelo>("gondola");
  const [papel, setPapel] = useState<Papel>("58");
  const [qtyMode, setQtyMode] = useState<"one" | "custom">("one");
  const [qtyCustom, setQtyCustom] = useState(5);
  const [flags, setFlags] = useState<Flags>({ sku: true, barcode: true, marca: true, preco: true });

  const perQty = qtyMode === "one" ? 1 : Math.max(1, qtyCustom);
  const totalEtiquetas = products.length * perQty;
  const preview = products[0];

  function toggle(k: keyof Flags) {
    setFlags((f) => ({ ...f, [k]: !f[k] }));
  }

  function onImprimir() {
    if (products.length === 0) return;
    printLabels(products, modelo, papel, flags, perQty);
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Imprimir etiquetas"
      description="Escolha o modelo da etiqueta e configure a impressão dos produtos selecionados."
      width="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted">
            {products.length} produto{products.length === 1 ? "" : "s"} · {totalEtiquetas} etiqueta{totalEtiquetas === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
            <Button size="sm" onClick={onImprimir} disabled={products.length === 0} className="gap-1.5">
              <Printer size={15} /> Imprimir etiquetas
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {/* ── Modelo da etiqueta ── */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">Modelo da etiqueta</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <ModeloCard
              active={modelo === "gondola"}
              onClick={() => setModelo("gondola")}
              icon={<Tag size={16} />}
              titulo="Etiqueta de Gôndola"
              descricao="Ideal para prateleiras e gôndolas, destacando o preço do produto."
              badge="Mais utilizada"
            />
            <ModeloCard
              active={modelo === "distribuidora"}
              onClick={() => setModelo("distribuidora")}
              icon={<Boxes size={16} />}
              titulo="Etiqueta Distribuidora"
              descricao="Ideal para caixas, estoque e identificação interna."
            />
          </div>
        </section>

        {/* ── Configuração da impressão ── */}
        <section className="space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-faint">Configuração da impressão</h3>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Papel</label>
            <Select value={papel} onChange={(e) => setPapel(e.target.value as Papel)} className="h-10">
              {(Object.keys(PAPEL_LABEL) as Papel[]).map((k) => (
                <option key={k} value={k}>{PAPEL_LABEL[k]}</option>
              ))}
            </Select>
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-medium text-ink">Quantidade</span>
            <div className="space-y-2">
              <RadioRow
                checked={qtyMode === "one"}
                onChange={() => setQtyMode("one")}
                label="Uma etiqueta por produto"
              />
              <RadioRow
                checked={qtyMode === "custom"}
                onChange={() => setQtyMode("custom")}
                label="Quantidade personalizada"
              />
              {qtyMode === "custom" && (
                <div className="ml-6 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={qtyCustom}
                    onChange={(e) => setQtyCustom(Math.max(1, Number(e.target.value) || 1))}
                    className="h-9 w-20 rounded-[var(--radius-sm)] border border-line bg-surface px-2.5 text-sm text-ink focus:border-brand focus:outline-none"
                  />
                  <span className="text-xs text-muted">aplicada a todos os produtos selecionados</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── Informações opcionais ── */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">Informações opcionais</h3>
          <div className="space-y-1">
            <CheckRow checked={flags.sku} onChange={() => toggle("sku")} label="Mostrar SKU" />
            <CheckRow checked={flags.barcode} onChange={() => toggle("barcode")} label="Mostrar código de barras" />
            <CheckRow checked={flags.marca} onChange={() => toggle("marca")} label="Mostrar marca" />
            {modelo === "gondola" && (
              <CheckRow checked={flags.preco} onChange={() => toggle("preco")} label="Mostrar preço" />
            )}
          </div>
        </section>

        {/* ── Pré-visualização ── */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">Pré-visualização</h3>
          {preview ? (
            <div className="rounded-[var(--radius)] border border-dashed border-line-strong bg-surface-2 p-5">
              <LabelPreview p={preview} modelo={modelo} flags={flags} />
              <p className="mt-3 text-center text-[11px] text-faint">
                Prévia ilustrativa · {preview.nome}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted">Nenhum produto selecionado.</p>
          )}
        </section>
      </div>
    </Sheet>
  );
}

// ── Peças ─────────────────────────────────────────────────────────────────────

function ModeloCard({
  active, onClick, icon, titulo, descricao, badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  titulo: string;
  descricao: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex flex-col gap-1.5 rounded-[var(--radius)] border p-3.5 text-left transition-colors",
        active
          ? "border-brand bg-brand-soft/50 ring-1 ring-brand"
          : "border-line bg-surface hover:bg-surface-2",
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn("grid h-8 w-8 place-items-center rounded-[var(--radius-sm)]", active ? "bg-brand text-on-brand" : "bg-surface-2 text-muted")}>
          {icon}
        </span>
        <span className="text-sm font-semibold text-ink">{titulo}</span>
        {active && <Check size={16} className="ml-auto text-brand" />}
      </div>
      <p className="text-xs leading-snug text-muted">{descricao}</p>
      {badge && (
        <span className="mt-0.5 inline-flex w-fit items-center rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand-strong">
          {badge}
        </span>
      )}
    </button>
  );
}

function RadioRow({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink">
      <span className={cn(
        "grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors",
        checked ? "border-brand" : "border-line-strong",
      )}>
        {checked && <span className="h-2 w-2 rounded-full bg-brand" />}
      </span>
      <input type="radio" checked={checked} onChange={onChange} className="sr-only" />
      {label}
    </label>
  );
}

function CheckRow({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] py-1.5 text-sm text-ink">
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
