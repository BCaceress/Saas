import { Sk, SkTable } from "@/components/app/skeletons";

/**
 * Skeleton das sub-rotas de estoque. O cabeçalho (layout) persiste;
 * aqui: card único com busca/filtros + tabela — espelha SaldosView.
 */
export default function EstoqueLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-4" aria-busy="true" aria-label="Carregando estoque">
      <div className="w-full rounded-[var(--radius-lg)] bg-surface p-3 shadow-[var(--shadow-float)] sm:p-4">
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-line bg-surface-2 p-2">
          <Sk className="h-9 min-w-48 flex-1 rounded-full bg-surface" />
          <Sk className="h-9 w-32 rounded-full bg-surface" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Sk key={i} className="hidden h-9 w-28 rounded-full bg-surface md:block" />
          ))}
          <Sk className="ml-auto h-9 w-9 shrink-0 rounded-full bg-surface" />
        </div>
        <div className="mt-4">
          <SkTable rows={8} />
        </div>
      </div>
    </div>
  );
}
