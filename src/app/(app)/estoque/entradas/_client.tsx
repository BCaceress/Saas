"use client";

import { useEffect, useState } from "react";
import { Eye, Truck, ClipboardList, X, Download, Wine, PackageOpen } from "lucide-react";
import { brl } from "@/lib/utils";
import type { EntradaRow } from "../_data";

const fmtShort = (d: Date) =>
  d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

const fmtLong = (d: Date) =>
  d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

/* ── Geração do documento imprimível ─────────────────────────── */
function printEntrada(e: EntradaRow) {
  const total = e.items.reduce((s, i) => s + i.custoTotal, 0);
  const tipo = e.tipo === "FORNECEDOR" ? "Fornecedor" : "Manual";
  const geradoEm = new Date().toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const rows = e.items.map((item, idx) => {
    const unitQty = item.packagingFator ? item.quantidade * item.packagingFator : item.quantidade;
    const unit = unitQty > 0 ? item.custoTotal / unitQty : 0;
    const bg = idx % 2 === 0 ? "#ffffff" : "#f9fafb";
    const qtdEmb = item.quantidade % 1 === 0 ? item.quantidade : item.quantidade.toFixed(3);
    const qtdUn = unitQty % 1 === 0 ? unitQty : unitQty.toFixed(3);
    return `<tr style="background:${bg}">
      <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;vertical-align:top">
        <span style="display:block;font-size:13px;font-weight:600;color:#111827">${item.productNome}</span>
        <span style="display:block;font-family:monospace;font-size:11px;color:#9ca3af;margin-top:2px">${item.productSku}</span>
        <span style="display:block;font-size:10px;color:#9ca3af;margin-top:2px">${item.productTipo === "INSUMO" ? "Insumo" : "Simples"}</span>
      </td>
      <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280">${item.packagingNome ?? "—"}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;font-size:13px;color:#111827">${qtdEmb}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;font-size:13px;color:#6b7280">${qtdUn}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;font-size:13px;color:#6b7280">${brl(unit)}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;font-size:13px;font-weight:700;color:#111827">${brl(item.custoTotal)}</td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html><html lang="pt-BR"><head>
  <meta charset="UTF-8"/>
  <title>Entrada de Estoque — ${fmtShort(e.data)}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f6f8;color:#111827;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .page{max-width:820px;margin:32px auto;background:#fff;border-radius:4px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)}
    @media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:100%;border-radius:0}}
    .accent{height:4px;background:#f97316}
    .head{padding:28px 40px 24px;border-bottom:1px solid #eceef1;display:flex;align-items:flex-start;justify-content:space-between}
    .head-left .eyebrow{font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#9ca3af;margin-bottom:8px}
    .head-left .title{font-size:22px;font-weight:800;color:#111827;letter-spacing:-.02em}
    .head-left .date{font-size:13px;color:#6b7280;margin-top:4px}
    .head-right .badge{display:inline-block;border:1px solid #eceef1;background:#f5f6f8;color:#6b7280;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:4px 10px;border-radius:6px}
    .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border-bottom:1px solid #eceef1}
    .meta-cell{padding:16px 24px;border-right:1px solid #eceef1}
    .meta-cell:last-child{border-right:none}
    .meta-cell .lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#9ca3af;margin-bottom:5px}
    .meta-cell .val{font-size:14px;font-weight:600;color:#111827}
    .meta-cell .sub{font-size:12px;color:#6b7280;margin-top:2px}
    table{width:100%;border-collapse:collapse}
    thead tr{background:#f5f6f8;border-top:1px solid #eceef1;border-bottom:2px solid #dfe2e7}
    thead th{padding:10px 16px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;text-align:left}
    thead th.r{text-align:right}
    .foot{padding:20px 40px;display:flex;justify-content:space-between;align-items:center;border-top:2px solid #111827}
    .foot .count{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#9ca3af}
    .foot .tot-lbl{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#9ca3af;margin-bottom:3px;text-align:right}
    .foot .tot-val{font-size:22px;font-weight:800;font-family:monospace;color:#f97316;letter-spacing:-.02em;text-align:right}
    .sig{padding:14px 40px;border-top:1px solid #eceef1;display:flex;justify-content:space-between;font-size:11px;color:#9ca3af}
  </style>
</head><body>
  <div class="page">
    <div class="accent"></div>
    <div class="head">
      <div class="head-left">
        <p class="eyebrow">NoHub Market</p>
        <p class="title">Entrada de Estoque</p>
        <p class="date">${fmtLong(e.data)}</p>
      </div>
      <div class="head-right">
        <span class="badge">${tipo}</span>
      </div>
    </div>
    <div class="meta">
      <div class="meta-cell">
        <p class="lbl">Fornecedor</p>
        <p class="val">${e.supplierNome ?? "Não informado"}</p>
        ${e.numeroNota ? `<p class="sub">NF ${e.numeroNota}</p>` : ""}
      </div>
      <div class="meta-cell">
        <p class="lbl">Itens</p>
        <p class="val">${e.totalItems} ${e.totalItems === 1 ? "produto" : "produtos"}</p>
      </div>
      <div class="meta-cell">
        <p class="lbl">Total geral</p>
        <p class="val" style="font-family:monospace;color:#f97316">${brl(total)}</p>
      </div>
    </div>
    <table>
      <thead><tr>
        <th>Produto</th><th>Embalagem</th>
        <th class="r">Qtd emb</th><th class="r">Qtd un</th><th class="r">Unitário</th><th class="r">Total</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="foot">
      <span class="count">${e.totalItems} ${e.totalItems === 1 ? "item" : "itens"}</span>
      <div>
        <p class="tot-lbl">Total da entrada</p>
        <p class="tot-val">${brl(total)}</p>
      </div>
    </div>
    <div class="sig">
      <span>Gerado em ${geradoEm}</span>
      <span>NoHub Market</span>
    </div>
  </div>
  <script>window.onload=function(){window.print()}</script>
</body></html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return;
  win.document.write(html);
  win.document.close();
}

/* ── Componente principal ─────────────────────────────────────── */
export function EntradasList({ entradas }: { entradas: EntradaRow[] }) {
  const [selected, setSelected] = useState<EntradaRow | null>(null);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [selected]);

  const total = selected ? selected.items.reduce((s, i) => s + i.custoTotal, 0) : 0;

  return (
    <>
      {/* ── Tabela de entradas ── */}
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left text-xs font-semibold uppercase tracking-wide text-faint">
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Fornecedor / Nota</th>
              <th className="px-4 py-3 text-right">Itens</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {entradas.map((e) => (
              <tr key={e.id} className="transition-colors hover:bg-surface-2">
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1.5">
                    {e.tipo === "FORNECEDOR" ? (
                      <Truck size={14} className="text-brand" />
                    ) : (
                      <ClipboardList size={14} className="text-muted" />
                    )}
                    <span className="text-xs font-medium">
                      {e.tipo === "FORNECEDOR" ? "Fornecedor" : "Manual"}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-ink">{e.supplierNome ?? "—"}</p>
                  {e.numeroNota && (
                    <p className="text-[11px] text-faint">NF {e.numeroNota}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink">
                  {e.totalItems}
                </td>
                <td className="px-4 py-3 text-muted">{fmtShort(e.data)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelected(e)}
                      className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand-soft"
                    >
                      <Eye size={13} /> Ver itens
                    </button>
                    <button
                      type="button"
                      onClick={() => printEntrada(e)}
                      className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2"
                    >
                      <Download size={13} /> PDF
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Modal — documento de entrada ── */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && setSelected(null)}
        >
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[var(--radius-xl)] border border-line bg-surface shadow-[var(--shadow-2)]">

            {/* Tira de acento laranja */}
            <div className="h-[3px] shrink-0 bg-brand" />

            {/* Cabeçalho do documento */}
            <div className="flex shrink-0 items-start justify-between gap-6 border-b border-line px-8 py-6">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-[.2em] text-faint">
                  NoHub Market
                </p>
                <p className="mt-1.5 font-display text-2xl font-extrabold tracking-tight text-ink">
                  Entrada de Estoque
                </p>
                <div className="mt-1 flex items-center gap-2 text-sm text-muted">
                  <span>{fmtLong(selected.data)}</span>
                  {selected.supplierNome && (
                    <>
                      <span className="text-faint">·</span>
                      <span className="font-medium text-ink-2">{selected.supplierNome}</span>
                      {selected.numeroNota && (
                        <span className="font-mono text-xs text-faint">NF {selected.numeroNota}</span>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {/* Badge tipo */}
                <span className="rounded-[var(--radius-sm)] border border-line bg-surface-2 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[.1em] text-muted">
                  {selected.tipo === "FORNECEDOR" ? "Fornecedor" : "Manual"}
                </span>
                {/* Fechar */}
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label="Fechar"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Tabela de itens */}
            <div className="overflow-y-auto">
              {selected.items.length === 0 ? (
                <p className="px-8 py-12 text-center text-sm text-muted">
                  Nenhum item registrado nesta entrada.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-line-strong bg-surface-2">
                      {[
                        { label: "Produto", right: false },
                        { label: "Embalagem", right: false },
                        { label: "Qtd emb", right: true },
                        { label: "Qtd un", right: true },
                        { label: "Unitário", right: true },
                        { label: "Custo total", right: true },
                      ].map(({ label, right }) => (
                        <th
                          key={label}
                          className={
                            "px-6 py-3 font-mono text-[10px] font-bold uppercase tracking-[.12em] text-faint " +
                            (right ? "text-right" : "text-left")
                          }
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {selected.items.map((item, idx) => {
                      const unitQty = item.packagingFator
                        ? item.quantidade * item.packagingFator
                        : item.quantidade;
                      const unit = unitQty > 0 ? item.custoTotal / unitQty : 0;
                      return (
                        <tr
                          key={item.id}
                          className={
                            idx % 2 === 0 ? "bg-surface" : "bg-surface-2/50"
                          }
                        >
                          {/* Produto */}
                          <td className="px-6 py-3.5">
                            <p className="font-semibold text-ink">
                              {item.productNome}
                            </p>
                            <span className="mt-0.5 inline-flex items-center gap-1.5">
                              {item.productTipo === "INSUMO" ? (
                                <PackageOpen size={10} className="shrink-0 text-muted" />
                              ) : (
                                <Wine size={10} className="shrink-0 text-muted" />
                              )}
                              <span className="font-mono text-[11px] text-faint">
                                {item.productSku}
                              </span>
                            </span>
                          </td>
                          {/* Embalagem */}
                          <td className="px-6 py-3.5 text-sm text-muted">
                            {item.packagingNome ?? "—"}
                          </td>
                          {/* Qtd embalagem */}
                          <td className="px-6 py-3.5 text-right font-mono tabular-nums text-ink">
                            {item.quantidade % 1 === 0
                              ? item.quantidade
                              : item.quantidade.toFixed(3)}
                          </td>
                          {/* Qtd unidade */}
                          <td className="px-6 py-3.5 text-right font-mono tabular-nums text-ink-2">
                            {unitQty % 1 === 0
                              ? unitQty
                              : unitQty.toFixed(3)}
                          </td>
                          {/* Unitário */}
                          <td className="px-6 py-3.5 text-right font-mono tabular-nums text-muted">
                            {brl(unit)}
                          </td>
                          {/* Custo total */}
                          <td className="px-6 py-3.5 text-right font-mono font-semibold tabular-nums text-ink">
                            {brl(item.custoTotal)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Rodapé — total com borda superior destacada */}
            {selected.items.length > 0 && (
              <div className="flex shrink-0 items-center justify-between border-t-2 border-line-strong bg-surface px-8 py-5">
                <span className="font-mono text-xs font-semibold uppercase tracking-widest text-faint">
                  {selected.totalItems}{" "}
                  {selected.totalItems === 1 ? "item" : "itens"}
                </span>
                <div className="text-right">
                  <p className="mb-1 font-mono text-[10px] font-bold uppercase tracking-[.12em] text-faint">
                    Total da entrada
                  </p>
                  <p className="font-mono text-3xl font-extrabold tracking-tight text-brand">
                    {brl(total)}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
