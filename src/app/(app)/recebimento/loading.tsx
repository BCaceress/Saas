import { Sk, SkPageHeader, SkTable, SkToolbar } from "@/components/app/skeletons";

/**
 * Skeleton da LISTA de recebimentos. Espelha `RecebimentosView`: cabeçalho com
 * a ação de receber, faixa de resumo baixa em grid único (não cards soltos — é
 * o mesmo desenho da tela), abas, filtros e UMA lista, a da aba selecionada. O
 * esqueleto promete a tela que vai abrir; a conferência de uma nota tem o seu,
 * em `[id]/loading.tsx`.
 */
export default function RecebimentosLoading() {
  return (
    <div
      className="flex animate-pulse flex-col gap-5"
      aria-busy="true"
      aria-label="Carregando os recebimentos"
    >
      <SkPageHeader actions={1} />

      {/* Resumo: um bloco baixo com divisores, igual ao da tela */}
      <div className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface lg:grid-cols-4 lg:divide-y-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1.5 px-4 py-3">
            <Sk className="h-3 w-24" />
            <Sk className="h-4 w-16" />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Sk key={i} className="h-8 w-28 rounded-full" />
          ))}
        </div>
        <SkToolbar pills={2} />
      </div>

      <SkTable rows={8} thumb={false} />

      <div className="flex items-center justify-between px-1">
        <Sk className="h-3 w-48" />
        <Sk className="h-8 w-40" />
      </div>
    </div>
  );
}
