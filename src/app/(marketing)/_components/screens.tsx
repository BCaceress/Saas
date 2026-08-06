"use client";

import { useState } from "react";
import {
  LayoutDashboard,
  ScanLine,
  BarChart3,
  DollarSign,
  ShoppingCart,
  AlertTriangle,
  TrendingUp,
  QrCode,
  CreditCard,
  Banknote,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SkuTag } from "@/components/sku-tag";

type Aba = "operacoes" | "pdv" | "relatorios";

const ABAS: { id: Aba; rotulo: string; icone: typeof LayoutDashboard; legenda: string }[] = [
  {
    id: "operacoes",
    rotulo: "Centro de operações",
    icone: LayoutDashboard,
    legenda:
      "Receita, lucro, pedidos em andamento e ruptura na primeira tela — com a leitura do assistente ao lado do número.",
  },
  {
    id: "pdv",
    rotulo: "PDV e recebimento",
    icone: ScanLine,
    legenda:
      "Venda no balcão com leitor, Pix na hora pelo Mercado Pago e baixa de estoque na unidade certa.",
  },
  {
    id: "relatorios",
    rotulo: "Relatórios",
    icone: BarChart3,
    legenda:
      "Curva ABC, giro e margem por produto. Monte o relatório que quiser e exporte em CSV.",
  },
];

/**
 * "Por dentro": em vez de quatro cartões de texto, as telas do sistema.
 * São reconstruções em HTML (não capturas de tela) de propósito — acompanham
 * o tema claro/escuro do visitante, ficam nítidas em qualquer densidade de
 * pixel e não envelhecem a cada mudança de layout do app.
 */
export function Screens() {
  const [aba, setAba] = useState<Aba>("operacoes");
  const atual = ABAS.find((a) => a.id === aba)!;

  return (
    <div className="flex flex-col gap-5">
      <div
        role="tablist"
        aria-label="Telas do sistema"
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
      >
        {ABAS.map((a) => {
          const Icone = a.icone;
          const ativo = a.id === aba;
          return (
            <button
              key={a.id}
              role="tab"
              aria-selected={ativo}
              onClick={() => setAba(a.id)}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                ativo
                  ? "border-brand bg-brand-soft text-brand-strong"
                  : "border-line bg-surface text-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icone size={15} />
              {a.rotulo}
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-2)]">
        <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2.5">
          <span className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          </span>
          <span className="ml-2 truncate font-mono text-[11px] text-faint">
            adega-do-ze.nohub.market
            {aba === "operacoes" ? "/inicio" : aba === "pdv" ? "/vendas" : "/relatorios"}
          </span>
        </div>

        <div key={aba} className="fade-up p-4 sm:p-6">
          {aba === "operacoes" && <TelaOperacoes />}
          {aba === "pdv" && <TelaPdv />}
          {aba === "relatorios" && <TelaRelatorios />}
        </div>
      </div>

      <p className="max-w-2xl text-sm leading-relaxed text-muted">{atual.legenda}</p>
    </div>
  );
}

/* ── Centro de operações ─────────────────────────────────── */

const KPIS = [
  { label: "Receita", valor: "R$ 18.420", delta: "+14%", tom: "ok", icone: DollarSign },
  { label: "Lucro bruto", valor: "R$ 6.117", delta: "+9%", tom: "ok", icone: TrendingUp },
  { label: "Pedidos em andamento", valor: "7", delta: "2 atrasados", tom: "warn", icone: ShoppingCart },
  { label: "Em ruptura", valor: "3", delta: "4% do catálogo", tom: "danger", icone: AlertTriangle },
] as const;

const SERIE = [38, 52, 44, 61, 49, 72, 66, 84, 70, 91, 78, 96];

function TelaOperacoes() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPIS.map((k) => {
          const Icone = k.icone;
          return (
            <div
              key={k.label}
              className="flex flex-col gap-1.5 rounded-[var(--radius)] border border-line bg-canvas p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-faint">{k.label}</span>
                <Icone size={13} className="text-faint" />
              </div>
              <span className="font-display text-xl font-bold text-ink tnum">{k.valor}</span>
              <span
                className={cn(
                  "text-[11px] font-medium",
                  k.tom === "ok" ? "text-ok" : k.tom === "warn" ? "text-warn" : "text-danger",
                )}
              >
                {k.delta}
              </span>
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-[var(--radius)] border border-line bg-canvas p-4">
          <p className="text-[11px] uppercase tracking-wider text-faint">Receita · últimos 12 dias</p>
          <div className="mt-4 flex h-28 items-end gap-1.5" aria-hidden>
            {SERIE.map((v, i) => (
              <div
                key={i}
                className={cn(
                  "flex-1 rounded-t-[3px]",
                  i === SERIE.length - 1 ? "bg-brand" : "bg-brand/35",
                )}
                style={{ height: `${v}%` }}
              />
            ))}
          </div>
        </div>

        <div className="rounded-[var(--radius)] border border-line bg-canvas p-4">
          <p className="text-[11px] uppercase tracking-wider text-faint">Leitura do assistente</p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            Cerveja long neck puxou <strong className="text-ink">38% da receita</strong> no fim de
            semana. Estoque atual cobre 2 dias no ritmo de sexta.
          </p>
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-medium text-brand-strong">
            Sugerir pedido de compra
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── PDV ─────────────────────────────────────────────────── */

const CARRINHO = [
  { nome: "Heineken Long Neck 330ml", sku: "BEB-CER-6489", qtd: 6, total: "47,40" },
  { nome: "Gelo 5kg", sku: "MER-GEL-0021", qtd: 1, total: "12,00" },
  { nome: "Amendoim japonês 150g", sku: "MER-SNK-0455", qtd: 2, total: "17,80" },
];

function TelaPdv() {
  return (
    <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 rounded-[var(--radius)] border border-brand bg-brand-soft px-3 py-2.5">
          <ScanLine size={16} className="text-brand-strong" />
          <span className="font-mono text-[13px] text-brand-strong">7891991010856</span>
          <span className="ml-auto text-[11px] font-medium text-brand-strong">lido</span>
        </div>

        <div className="divide-y divide-line rounded-[var(--radius)] border border-line bg-canvas">
          {CARRINHO.map((i) => (
            <div key={i.sku} className="flex items-center gap-3 px-3 py-2.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 font-mono text-[11px] font-semibold text-ink-2">
                {i.qtd}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">{i.nome}</p>
                <SkuTag sku={i.sku} className="mt-1" showBarcode={false} />
              </div>
              <span className="font-mono text-[13px] text-ink tnum">R$ {i.total}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-line bg-canvas p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] uppercase tracking-wider text-faint">Total</span>
          <span className="font-display text-2xl font-bold text-ink tnum">R$ 77,20</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { rotulo: "Pix", icone: QrCode, ativo: true },
            { rotulo: "Cartão", icone: CreditCard, ativo: false },
            { rotulo: "Dinheiro", icone: Banknote, ativo: false },
          ].map((m) => {
            const Icone = m.icone;
            return (
              <div
                key={m.rotulo}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-3 text-[11px] font-medium",
                  m.ativo
                    ? "border-brand bg-brand-soft text-brand-strong"
                    : "border-line bg-surface text-muted",
                )}
              >
                <Icone size={16} />
                {m.rotulo}
              </div>
            );
          })}
        </div>
        <div className="grid place-items-center rounded-[var(--radius-sm)] border border-line bg-surface p-4">
          <span className="barcode-strip h-16 w-16 rounded-[4px] opacity-70" aria-hidden />
          <p className="mt-2 text-[11px] text-muted">QR Pix gerado · aguardando pagamento</p>
        </div>
        <div className="mt-auto grid place-items-center rounded-full bg-brand py-2.5 text-sm font-medium text-on-brand">
          Finalizar venda
        </div>
      </div>
    </div>
  );
}

/* ── Relatórios ──────────────────────────────────────────── */

const ABC = [
  { nome: "Heineken Long Neck 330ml", classe: "A", receita: "R$ 4.812", margem: 34, part: 100 },
  { nome: "Skol Lata 350ml", classe: "A", receita: "R$ 3.190", margem: 29, part: 66 },
  { nome: "Coca-Cola 2L", classe: "B", receita: "R$ 1.744", margem: 22, part: 36 },
  { nome: "Vodka Absolut 1L", classe: "B", receita: "R$ 1.068", margem: 41, part: 22 },
  { nome: "Amendoim japonês 150g", classe: "C", receita: "R$ 312", margem: 48, part: 7 },
];

function TelaRelatorios() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {["Curva ABC", "Últimos 30 dias", "Todas as lojas"].map((f) => (
          <span
            key={f}
            className="rounded-full border border-line bg-canvas px-3 py-1 text-[11px] font-medium text-ink-2"
          >
            {f}
          </span>
        ))}
        <span className="ml-auto rounded-full bg-brand-soft px-3 py-1 text-[11px] font-medium text-brand-strong">
          Exportar CSV
        </span>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius)] border border-line bg-canvas">
        <table className="w-full min-w-[19rem] text-left">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wider text-faint">
              <th className="px-3 py-2 font-medium">Produto</th>
              <th className="px-3 py-2 font-medium">Classe</th>
              <th className="px-3 py-2 font-medium">Receita</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">Participação</th>
              <th className="px-3 py-2 text-right font-medium">Margem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ABC.map((l) => (
              <tr key={l.nome}>
                <td className="max-w-[14rem] truncate px-3 py-2.5 text-[13px] font-medium text-ink">
                  {l.nome}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={cn(
                      "inline-grid h-5 w-5 place-items-center rounded-full font-mono text-[11px] font-semibold",
                      l.classe === "A"
                        ? "bg-ok-soft text-ok"
                        : l.classe === "B"
                          ? "bg-warn-soft text-warn"
                          : "bg-surface-2 text-muted",
                    )}
                  >
                    {l.classe}
                  </span>
                </td>
                <td className="px-3 py-2.5 font-mono text-[13px] text-ink-2 tnum">{l.receita}</td>
                <td className="hidden px-3 py-2.5 sm:table-cell">
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line" aria-hidden>
                    <div className="h-full rounded-full bg-brand" style={{ width: `${l.part}%` }} />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-[13px] text-ink tnum">
                  {l.margem}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
