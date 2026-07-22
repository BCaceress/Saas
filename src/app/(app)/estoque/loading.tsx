import { Sk, SkTable } from "@/components/app/skeletons";

/**
 * Skeleton das sub-rotas de estoque. O cabeçalho (layout) persiste;
 * aqui: indicadores + busca/pills de filtro + tabela de saldos —
 * espelha os cards Kpi + toolbar de SaldosView.
 */
export default function EstoqueLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-4" aria-busy="true" aria-label="Carregando estoque">
      {/* Indicadores */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5">
            <Sk className="h-8 w-8 shrink-0 rounded-lg" />
            <div className="flex min-w-0 flex-col gap-1.5">
              <Sk className="h-2.5 w-20" />
              <Sk className="h-4 w-12" />
            </div>
          </div>
        ))}
      </div>

      {/* Busca + pills de filtro */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Sk className="h-9 w-full rounded-lg sm:max-w-lg" />
        <div className="flex flex-1 items-center gap-1.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Sk key={i} className="h-8 w-24 shrink-0 rounded-full" />
          ))}
          <Sk className="ml-auto h-9.5 w-24 shrink-0 rounded-lg" />
        </div>
      </div>

      <SkTable rows={8} />
    </div>
  );
}
