import { ScanBarcode, TrendingUp, AlertTriangle } from "lucide-react";
import { SkuTag } from "@/components/sku-tag";
import { StockGauge } from "@/components/stock-gauge";

const LINHAS = [
  {
    nome: "Heineken Long Neck 330ml",
    sku: "BEB-CER-6489",
    preco: "R$ 7,90",
    fechado: 48,
    ideal: 60,
    min: 24,
  },
  {
    nome: "Coca-Cola 2L",
    sku: "BEB-REF-1207",
    preco: "R$ 9,50",
    fechado: 12,
    ideal: 40,
    min: 18,
  },
  {
    nome: "Vodka Absolut 1L",
    sku: "BEB-DES-3344",
    preco: "R$ 89,00",
    fechado: 4,
    ideal: 6,
    min: 2,
    frac: true,
    aberto: 200,
    conteudo: 1000,
  },
];

/**
 * Prévia do herói: a tela de produtos montada com os componentes REAIS
 * (SkuTag, StockGauge). Não é um mockup desenhado — é o mesmo medidor
 * dois-saldos que o operador vê depois de entrar, o que faz a promessa da
 * landing e o produto combinarem pixel a pixel.
 *
 * Ao redor dela, dois cartões flutuantes recortam o quadro e dão profundidade:
 * um positivo (margem) e um de alerta (ruptura) — os dois números que fazem o
 * lojista abrir o sistema de manhã.
 */
export function HeroVisual() {
  return (
    <div className="relative">
      {/* Halo atrás do quadro. z-0 (não negativo): com z negativo ele ficaria
          atrás do `bg-canvas` do layout e não apareceria. */}
      <div
        aria-hidden
        className="absolute -inset-6 z-0 rounded-[3rem] bg-brand-softer/70 blur-3xl"
      />

      <div className="relative z-10 overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-2)]">
        {/* barra de janela — dá o enquadramento de "isto é um sistema" */}
        <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2.5">
          <span className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          </span>
          <span className="ml-2 truncate font-mono text-[11px] text-faint">
            adega-do-ze.nohub.market/produtos
          </span>
        </div>

        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="font-display text-sm font-semibold text-ink">Produtos</span>
          <span className="flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-medium text-brand-strong">
            <ScanBarcode size={13} /> Escanear EAN
          </span>
        </div>

        <table className="w-full text-left">
          <thead>
            {/* Preço sai no celular: Produto + SKU + medidor já não cabem em
                360px com uma quarta medida ao lado — e o medidor é o que a
                landing promete. */}
            <tr className="border-b border-line text-[10px] uppercase tracking-wider text-faint">
              <th className="px-3 py-2 font-medium sm:px-4">Produto</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell sm:px-4">Preço</th>
              <th className="px-3 py-2 font-medium sm:px-4">Estoque</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {LINHAS.map((r) => (
              <tr key={r.sku}>
                <td className="px-3 py-3 sm:px-4">
                  <div className="text-[13px] font-medium text-ink">{r.nome}</div>
                  <SkuTag sku={r.sku} className="mt-1" />
                </td>
                <td className="hidden px-3 py-3 font-mono text-[13px] text-ink-2 tnum sm:table-cell sm:px-4">
                  {r.preco}
                </td>
                <td className="px-3 py-3 sm:px-4">
                  <StockGauge
                    fechado={r.fechado}
                    ideal={r.ideal}
                    minimo={r.min}
                    fracionavel={r.frac}
                    aberto={r.aberto}
                    conteudoPorUnidade={r.conteudo}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cartão positivo — recorta o canto inferior esquerdo */}
      <div className="mkt-float absolute -bottom-6 -left-4 z-20 hidden w-max rounded-[var(--radius)] border border-line bg-surface p-3 shadow-[var(--shadow-2)] sm:block">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] bg-ok-soft text-ok">
            <TrendingUp size={16} />
          </span>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-faint">Margem do dia</p>
            <p className="font-mono text-sm font-semibold text-ink tnum">
              R$ 1.284,00 <span className="text-[11px] font-medium text-ok">+12%</span>
            </p>
          </div>
        </div>
      </div>

      {/* Cartão de alerta — o motivo de abrir o sistema */}
      <div
        className="mkt-float absolute -top-9 -right-7 z-20 hidden w-max rounded-[var(--radius)] border border-line bg-surface p-3 shadow-[var(--shadow-2)] lg:block"
        style={{ animationDelay: "-3s" }}
      >
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] bg-danger-soft text-danger">
            <AlertTriangle size={16} />
          </span>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-faint">Vai faltar</p>
            <p className="text-sm font-semibold text-ink">3 produtos abaixo do mínimo</p>
          </div>
        </div>
      </div>
    </div>
  );
}
