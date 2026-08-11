import { Sk, SkPageHeader } from "@/components/app/skeletons";

/**
 * Skeleton do catálogo — espelha a tela real: cabeçalho, card com a barra de
 * filtros, tabela (md+) e cards (mobile), mais o rodapé de paginação.
 * As larguras e os breakpoints das colunas repetem os da tabela em `_client.tsx`
 * para o conteúdo não "pular" quando os dados chegam.
 */
export default function ProdutosLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy="true" aria-label="Carregando produtos">
      <SkPageHeader actions={2} />

      <div className="w-full rounded-[var(--radius-lg)] bg-surface p-3 shadow-[var(--shadow-float)] sm:p-4">
        {/* Barra de filtros: busca + pills */}
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-line bg-surface-2 p-2">
          <Sk className="h-9 min-w-48 flex-1 rounded-full bg-surface" />
          <Sk className="hidden h-9 w-32 rounded-full bg-surface md:block" />
          <Sk className="hidden h-9 w-36 rounded-full bg-surface lg:block" />
          <Sk className="hidden h-9 w-28 rounded-full bg-surface xl:block" />
          <Sk className="h-9 w-24 rounded-full bg-surface" />
          <Sk className="h-9 w-28 rounded-full bg-surface" />
        </div>

        {/* ── Tabela (md+) ── */}
        <div className="mt-4 hidden overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface md:block">
          <div className="flex items-center border-b border-line bg-surface-2 px-3 py-2.5">
            <div className="w-10"><Sk className="h-3.5 w-3.5 rounded-[4px] bg-line" /></div>
            <div className="flex-1 px-1"><Sk className="h-2.5 w-16 bg-line" /></div>
            <div className="hidden w-36 px-4 xl:block"><Sk className="h-2.5 w-12 bg-line" /></div>
            <div className="hidden w-28 px-4 lg:block"><Sk className="h-2.5 w-10 bg-line" /></div>
            <div className="hidden w-44 px-4 lg:block"><Sk className="h-2.5 w-16 bg-line" /></div>
            <div className="w-32 px-4"><Sk className="h-2.5 w-12 bg-line" /></div>
            <div className="hidden w-24 px-4 sm:block"><Sk className="h-2.5 w-12 bg-line" /></div>
            <div className="hidden w-40 px-4 md:block"><Sk className="h-2.5 w-20 bg-line" /></div>
            <div className="w-28 px-4"><Sk className="h-2.5 w-14 bg-line" /></div>
            <div className="w-10" />
          </div>

          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center border-b border-line px-3 py-1.5 last:border-b-0">
              <div className="w-10"><Sk className="h-3.5 w-3.5 rounded-[4px]" /></div>

              {/* Produto: foto + nome + SKU */}
              <div className="flex min-w-0 flex-1 items-center gap-3 px-1">
                <Sk className="h-9 w-9 shrink-0 rounded-[var(--radius-sm)]" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Sk className={larguraNome(i)} />
                  <Sk className="h-2.5 w-24 rounded-full" />
                </div>
              </div>

              <div className="hidden w-36 px-4 xl:block"><Sk className="h-3 w-20" /></div>
              <div className="hidden w-28 px-4 lg:block"><Sk className="h-5 w-16 rounded-full" /></div>
              <div className="hidden w-44 px-4 lg:block"><Sk className="h-3 w-28" /></div>
              <div className="w-32 px-4"><Sk className="h-3.5 w-16" /></div>
              <div className="hidden w-24 px-4 sm:block"><Sk className="h-3 w-10" /></div>
              <div className="hidden w-40 px-4 md:block"><Sk className="h-3 w-24" /></div>

              {/* Estoque: número + medidor (a assinatura da coluna) */}
              <div className="flex w-28 flex-col gap-1 px-4">
                <div className="flex items-center gap-1.5">
                  <Sk className="h-2 w-2 rounded-full" />
                  <Sk className="h-3 w-10" />
                </div>
                <Sk className="h-1 w-16 rounded-full" />
              </div>

              <div className="w-10"><Sk className="h-5 w-5 rounded-full" /></div>
            </div>
          ))}
        </div>

        {/* ── Cards (mobile) ── */}
        <ul className="mt-4 space-y-2 md:hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-3">
              <Sk className="h-11 w-11 shrink-0 rounded-[var(--radius-sm)]" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Sk className="h-3.5 w-2/3" />
                <Sk className="h-2.5 w-24 rounded-full" />
                <div className="mt-0.5 flex items-center gap-3">
                  <Sk className="h-3 w-14" />
                  <Sk className="h-3 w-10" />
                </div>
              </div>
              <Sk className="h-5 w-5 shrink-0 rounded-full" />
            </li>
          ))}
        </ul>

        {/* ── Paginação ── */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2">
            <Sk className="h-3 w-28" />
            <Sk className="hidden h-7 w-36 rounded-lg sm:block" />
          </div>
          <div className="flex items-center gap-1.5">
            <Sk className="h-8 w-8 rounded-lg" />
            <Sk className="h-3 w-20" />
            <Sk className="h-8 w-8 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Nome do produto com comprimento variável — bloco uniforme parece falso. */
function larguraNome(i: number) {
  const w = ["w-1/2", "w-2/3", "w-3/5", "w-5/12", "w-7/12"][i % 5];
  return `h-3.5 ${w}`;
}
