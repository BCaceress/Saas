import { Sk } from "@/components/app/skeletons";

/** Skeleton do PDV: busca + grade de produtos à esquerda, carrinho à direita. */
export default function VendasLoading() {
  return (
    <div className="flex animate-pulse gap-4" aria-busy="true" aria-label="Carregando PDV">
      {/* Catálogo */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <Sk className="h-11 w-full rounded-xl" />
        <div className="flex items-center gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Sk key={i} className="h-8 w-24 rounded-full" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
              <Sk className="aspect-square w-full rounded-lg" />
              <Sk className="h-3.5 w-3/4" />
              <Sk className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>

      {/* Carrinho */}
      <div className="hidden w-80 shrink-0 flex-col gap-3 rounded-xl border border-line bg-surface p-4 lg:flex">
        <Sk className="h-5 w-24" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <Sk className="h-9 w-9 shrink-0 rounded-lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Sk className="h-3 w-3/4" />
              <Sk className="h-3 w-1/3" />
            </div>
            <Sk className="h-4 w-12" />
          </div>
        ))}
        <div className="mt-auto flex flex-col gap-2 border-t border-line pt-3">
          <Sk className="h-8 w-full" />
          <Sk className="h-11 w-full rounded-full" />
        </div>
      </div>
    </div>
  );
}
