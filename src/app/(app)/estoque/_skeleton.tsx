import { Search, ChevronsUpDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { SkBarra } from "@/components/app/skeletons";

/**
 * Esqueleto da lista de saldos — mesma regra de /produtos: o CHROME aparece
 * inteiro na hora (busca, filtros, cabeçalho das colunas, rodapé) e só as
 * LINHAS ficam em placeholder. A página já abriu; faltam os dados.
 *
 * As larguras e os paddings são os mesmos da tabela real, então nada se desloca
 * quando as linhas chegam. Sem spinner central e sem `animate-pulse` no
 * wrapper: o brilho é o `.sk-shimmer` (1.4s) do globals.css.
 *
 * O rótulo da coluna de meta fica em "Estoque" (o neutro): o `loading.tsx` roda
 * antes de sabermos a estratégia da empresa, e trocar o texto depois seria pior
 * do que começar certo na maioria dos casos.
 */

const LARGURA_NOME = ["w-1/2", "w-2/3", "w-3/5", "w-5/12", "w-7/12"];

export function LinhasEstoqueSkeleton({ linhas = 8 }: { linhas?: number }) {
  return (
    <>
      {Array.from({ length: linhas }).map((_, i) => (
        <tr key={i} aria-hidden>
          <td className="py-2 pl-2 pr-0">
            <SkBarra className="h-4 w-4" />
          </td>

          {/* Produto: miniatura + nome + situação + SKU */}
          <td className="py-2 pl-2 pr-4">
            <div className="flex items-center gap-3">
              <SkBarra className="h-9.5 w-9.5 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <SkBarra className={cn("h-3.5", LARGURA_NOME[i % LARGURA_NOME.length])} />
                <SkBarra className="mt-1.5 h-2.5 w-20" />
                <SkBarra className="mt-1 h-2.5 w-28" />
              </div>
            </div>
          </td>

          {/* Local */}
          <td className="px-4 py-2">
            <SkBarra className="h-3 w-24" />
          </td>

          {/* Estoque: número + barra da meta + rodapé — a assinatura da coluna */}
          <td className="px-4 py-2">
            <div className="w-40 max-w-full">
              <SkBarra className="h-3.5 w-16" />
              <SkBarra className="mt-1.5 h-2 w-full" />
              <SkBarra className="mt-1.5 h-2.5 w-24" />
            </div>
          </td>

          {/* Aberto (consumo/drinks) */}
          <td className="hidden px-4 py-2 lg:table-cell">
            <SkBarra className="h-3 w-20" />
          </td>

          {/* Fornecedor */}
          <td className="hidden px-4 py-2 md:table-cell">
            <SkBarra className="h-3 w-24" />
          </td>

          {/* Pedido */}
          <td className="hidden px-4 py-2 md:table-cell">
            <SkBarra className="h-3 w-16" />
          </td>

          <td className="px-3 py-2">
            <ChevronRight size={16} className="ml-auto text-line" aria-hidden />
          </td>
        </tr>
      ))}
    </>
  );
}

/** Cards do mobile — a tabela some abaixo de md. */
export function CardsEstoqueSkeleton({ linhas = 6, className }: { linhas?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2.5", className)} aria-hidden>
      {Array.from({ length: linhas }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5">
          <SkBarra className="mt-1 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <SkBarra className="h-9.5 w-9.5 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <SkBarra className={cn("h-3.5", LARGURA_NOME[i % LARGURA_NOME.length])} />
                <SkBarra className="mt-1.5 h-2.5 w-24" />
              </div>
            </div>
            <div className="mt-2 w-40 max-w-full">
              <SkBarra className="h-3.5 w-16" />
              <SkBarra className="mt-1.5 h-2 w-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Chrome real + linhas em placeholder — o corpo inteiro de /estoque. */
export function CorpoEstoqueSkeleton({ linhas = 8 }: { linhas?: number }) {
  return (
    <div className="w-full rounded-[var(--radius-lg)] bg-surface p-3 shadow-[var(--shadow-float)] sm:p-4">
      {/* Barra de filtros — desenho real, inerte enquanto os dados não chegam */}
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-line bg-surface-2 p-2">
        <div className="relative min-w-48 flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
          <div className="flex h-9 items-center truncate rounded-full border border-line bg-surface pl-9 pr-3 text-sm text-faint">
            Buscar por nome, SKU, código, categoria, marca ou fornecedor…
          </div>
        </div>
        <ChipInerte>Todos</ChipInerte>
        <ChipInerte className="hidden lg:inline-flex">Toda categoria</ChipInerte>
        <ChipInerte className="hidden xl:inline-flex">Todo fornecedor</ChipInerte>
        <ChipInerte>Mais filtros</ChipInerte>
        <ChipInerte>Exibição</ChipInerte>
      </div>

      {/* ── Tabela (md+): cabeçalho real, linhas em placeholder ── */}
      <div className="mt-4 hidden overflow-clip rounded-xl border border-line bg-surface md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left text-xs font-semibold uppercase tracking-wide text-faint">
              <th className="w-8 py-2 pl-2 pr-0">
                <span className="inline-block h-4 w-4 rounded-full border border-line-strong bg-surface" aria-hidden />
              </th>
              <Th label="Produto" className="pl-2" ordenavel />
              <Th label="Local" />
              <Th label="Estoque" ordenavel />
              <Th label="Aberto" className="hidden lg:table-cell" />
              <Th label="Fornecedor" className="hidden md:table-cell" />
              <Th label="Pedido" className="hidden md:table-cell" />
              <th className="w-px px-3 py-2" aria-hidden />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            <LinhasEstoqueSkeleton linhas={linhas} />
          </tbody>
        </table>
      </div>

      {/* ── Cards (mobile) ── */}
      <CardsEstoqueSkeleton linhas={6} className="mt-4 md:hidden" />

      {/* ── Rodapé de paginação ── */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1">
        <SkBarra className="h-3 w-48" />
        <div className="flex items-center gap-1.5">
          <SkBarra className="h-8 w-8 rounded-lg" />
          <SkBarra className="h-3 w-20" />
          <SkBarra className="h-8 w-8 rounded-lg" />
        </div>
      </div>

      <span className="sr-only" role="status">Carregando estoque…</span>
    </div>
  );
}

function Th({ label, className, ordenavel = false }: { label: string; className?: string; ordenavel?: boolean }) {
  return (
    <th className={cn("px-4 py-2", className)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {ordenavel && <ChevronsUpDown size={12} className="opacity-40" aria-hidden />}
      </span>
    </th>
  );
}

function ChipInerte({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-9 items-center rounded-full border border-line bg-surface px-3.5 text-xs font-medium text-faint",
        className,
      )}
    >
      {children}
    </span>
  );
}
