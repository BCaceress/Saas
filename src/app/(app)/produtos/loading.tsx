import { Sk, SkPageHeader, SkTable } from "@/components/app/skeletons";

/** Skeleton do catálogo: cabeçalho + card com barra de filtros + tabela. */
export default function ProdutosLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy="true" aria-label="Carregando produtos">
      <SkPageHeader actions={2} />
      <div className="w-full rounded-[var(--radius-lg)] bg-surface p-3 shadow-[var(--shadow-float)] sm:p-4">
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-line bg-surface-2 p-2">
          <Sk className="h-9 min-w-56 flex-1 rounded-full bg-surface" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Sk key={i} className="hidden h-9 w-32 rounded-full bg-surface md:block" />
          ))}
        </div>
        <div className="mt-4">
          <SkTable rows={9} />
        </div>
      </div>
    </div>
  );
}
