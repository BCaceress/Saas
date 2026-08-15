import { Search, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { SkBarra } from "@/components/app/skeletons";
import {
  COL_LABEL, COL_ORDER, COL_TH_CLASS, DEFAULT_COLS,
  type ColKey, type Density,
} from "./_colunas";

/**
 * Esqueleto da listagem de produtos.
 *
 * Regra da tela: o CHROME aparece inteiro na hora (título, ações, busca,
 * filtros, cabeçalho das colunas) — só as LINHAS ficam em placeholder. O
 * operador vê a página já aberta e entende que faltam apenas os dados.
 *
 * As classes de largura/padding vêm de `_colunas.ts` e são as mesmas do `<th>`
 * real: quando as linhas chegam, nada se desloca. Sem spinner central, sem
 * `animate-pulse` — o brilho é o `.sk-shimmer` (1.4s) do globals.css.
 *
 * Server Component: `loading.tsx` monta a tela inteira, `_client.tsx` reaproveita
 * só as linhas (troca de filtro e "carregar mais").
 */

/** Bloco cinza com shimmer — definição única em `components/app/skeletons`. */
export { SkBarra };

// ── Linhas da tabela (md+) ───────────────────────────────────────────────────

/** Nome do produto com comprimento variável — bloco uniforme parece falso. */
const LARGURA_NOME = ["w-1/2", "w-2/3", "w-3/5", "w-5/12", "w-7/12"];

/**
 * Linhas `<tr>` de placeholder — vão DENTRO do `<tbody>` da tabela real, para
 * herdar `table-fixed` e as larguras já resolvidas pelo cabeçalho.
 */
export function LinhasSkeleton({
  linhas = 8,
  cols = DEFAULT_COLS,
  density = "compact",
}: {
  linhas?: number;
  cols?: Record<ColKey, boolean>;
  density?: Density;
}) {
  const denso = density === "denso";
  const cellPad = denso ? "py-1" : "py-1.5";

  return (
    <>
      {Array.from({ length: linhas }).map((_, i) => (
        <tr key={i} aria-hidden>
          <td className={cn("px-3", cellPad)}>
            <SkBarra className="h-4 w-4" />
          </td>

          {/* Produto: miniatura 36×36 + nome + SKU/código de barras */}
          <td className={cn("px-4", cellPad)}>
            <div className="flex items-center gap-3">
              {!denso && <SkBarra className="h-9 w-9 shrink-0 rounded-[var(--radius-sm)]" />}
              <div className="min-w-0 flex-1">
                <SkBarra className={cn("h-3.5", LARGURA_NOME[i % LARGURA_NOME.length])} />
                {!denso && <SkBarra className="mt-1.5 h-2.5 w-28" />}
              </div>
            </div>
          </td>

          {cols.marca && <TdSk className={COL_TH_CLASS.marca} pad={cellPad} bar="h-3 w-20" />}
          {cols.tipo && <TdSk className={COL_TH_CLASS.tipo} pad={cellPad} bar="h-5 w-16" />}
          {cols.categoria && <TdSk className={COL_TH_CLASS.categoria} pad={cellPad} bar="h-3 w-28" />}
          <TdSk className="w-32" pad={cellPad} bar="h-3.5 w-16" />
          {cols.local && <TdSk className={COL_TH_CLASS.local} pad={cellPad} bar="h-3 w-24" />}
          {cols.margem && <TdSk className={COL_TH_CLASS.margem} pad={cellPad} bar="h-3 w-10" />}
          {cols.fornecedor && <TdSk className={COL_TH_CLASS.fornecedor} pad={cellPad} bar="h-3 w-24" />}

          {/* Estoque: pastilha + número + medidor (a assinatura da coluna) */}
          {cols.estoque && (
            <td className={cn("px-4", COL_TH_CLASS.estoque, cellPad)}>
              <div className="flex items-center gap-1.5">
                <SkBarra className="h-1.5 w-1.5" />
                <SkBarra className="h-3 w-10" />
              </div>
              <SkBarra className="mt-1 h-1 w-16" />
            </td>
          )}

          {cols.vendas && <TdSk className={COL_TH_CLASS.vendas} pad={cellPad} bar="h-3 w-10" />}
          {cols.parado && <TdSk className={COL_TH_CLASS.parado} pad={cellPad} bar="h-3 w-12" />}

          {/* Menu de três pontos */}
          <td className={cn("px-3", cellPad)}>
            <SkBarra className="h-4 w-4" />
          </td>
        </tr>
      ))}
    </>
  );
}

function TdSk({ className, pad, bar }: { className: string; pad: string; bar: string }) {
  return (
    <td className={cn("px-4", className, pad)}>
      <SkBarra className={bar} />
    </td>
  );
}

// ── Cards (mobile / "carregar mais") ─────────────────────────────────────────

export function CardsSkeleton({ linhas = 4, className }: { linhas?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden>
      {Array.from({ length: linhas }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-[var(--radius)] border border-line bg-surface p-2.5"
        >
          <SkBarra className="h-4 w-4 shrink-0" />
          <SkBarra className="h-9 w-9 shrink-0 rounded-[var(--radius-sm)]" />
          <div className="min-w-0 flex-1">
            <SkBarra className={cn("h-3.5", LARGURA_NOME[i % LARGURA_NOME.length])} />
            <SkBarra className="mt-1 h-2.5 w-28" />
            <div className="mt-1.5 flex items-center gap-3">
              <SkBarra className="h-3 w-14" />
              <SkBarra className="h-3 w-10" />
              <SkBarra className="h-3 w-12" />
            </div>
          </div>
          <SkBarra className="h-4 w-4 shrink-0" />
        </div>
      ))}
    </div>
  );
}

// ── Tela inteira (loading.tsx) ───────────────────────────────────────────────

/**
 * Chrome real + linhas em placeholder. O cabeçalho da página vem do
 * `loading.tsx`, que usa o `PageHeader` de verdade; aqui fica o card com a
 * barra de busca, os filtros, a tabela e o rodapé.
 */
export function CorpoProdutosSkeleton({ linhas = 8 }: { linhas?: number }) {
  const cols = DEFAULT_COLS;
  // Preço fica entre "categoria" e "local" na tabela real — as colunas
  // opcionais se dividem em torno dele.
  const corte = COL_ORDER.indexOf("local");
  const visiveis = COL_ORDER.filter((k) => cols[k]);
  const antesDoPreco = visiveis.filter((k) => COL_ORDER.indexOf(k) < corte);
  const depoisDoPreco = visiveis.filter((k) => COL_ORDER.indexOf(k) >= corte);

  return (
    <div className="w-full rounded-[var(--radius-lg)] bg-surface p-3 shadow-[var(--shadow-float)] sm:p-4">
      {/* Barra de filtros — desenho real, inerte enquanto os dados não chegam */}
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-line bg-surface-2 p-2">
        <div className="relative min-w-48 flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
          <div className="flex h-9 items-center rounded-full border border-line bg-surface pl-9 pr-3 text-sm text-faint">
            Buscar nome, SKU ou código de barras
          </div>
        </div>
        <ChipInerte>Todos os tipos</ChipInerte>
        <ChipInerte className="hidden lg:inline-flex">Toda categoria</ChipInerte>
        <ChipInerte className="hidden xl:inline-flex">Ativos</ChipInerte>
        <ChipInerte>Filtros</ChipInerte>
        <ChipInerte>Colunas</ChipInerte>
      </div>

      {/* ── Tabela (md+): cabeçalho real, linhas em placeholder ── */}
      <div className="mt-4 hidden overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface md:block">
        <table className="w-full table-fixed text-left">
          <thead className="border-b border-line bg-surface-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <span className="inline-block h-4 w-4 rounded-full border border-line-strong bg-surface" aria-hidden />
              </th>
              <Th label="Produto" />
              {antesDoPreco.map((k) => (
                <Th key={k} label={COL_LABEL[k]} className={COL_TH_CLASS[k]} />
              ))}
              <Th label="Preço" className="w-32" />
              {depoisDoPreco.map((k) => (
                <Th key={k} label={COL_LABEL[k]} className={COL_TH_CLASS[k]} />
              ))}
              <th className="w-10 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            <LinhasSkeleton linhas={linhas} cols={cols} />
          </tbody>
        </table>
      </div>

      {/* ── Cards (mobile) ── */}
      <CardsSkeleton linhas={6} className="mt-4 md:hidden" />

      {/* ── Rodapé de paginação ── */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1">
        <SkBarra className="h-3 w-48" />
        <div className="flex items-center gap-1.5">
          <SkBarra className="h-8 w-8 rounded-lg" />
          <SkBarra className="h-3 w-20" />
          <SkBarra className="h-8 w-8 rounded-lg" />
        </div>
      </div>

      <span className="sr-only" role="status">Carregando produtos…</span>
    </div>
  );
}

/** `<th>` com o mesmo desenho do ordenável, sem o clique. */
function Th({ label, className }: { label: string; className?: string }) {
  return (
    <th className={cn("px-4 py-2.5", className)}>
      <span className="inline-flex items-center gap-1">
        {label}
        <ChevronsUpDown size={12} className="opacity-40" aria-hidden />
      </span>
    </th>
  );
}

function ChipInerte({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-9 items-center rounded-full border border-line bg-surface px-3.5 text-sm text-faint",
        className,
      )}
    >
      {children}
    </span>
  );
}
