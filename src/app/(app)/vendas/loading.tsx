import { Sk } from "@/components/app/skeletons";

/** Skeleton do PDV: busca + carrinho à esquerda, caixa + fila do autoatendimento à direita. */
export default function VendasLoading() {
  return (
    <div
      className="flex animate-pulse flex-col gap-2.5 pt-2 lg:h-full lg:min-h-0"
      aria-busy="true"
      aria-label="Carregando PDV"
    >
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_330px] lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* ── Venda atual ── */}
        <section className="flex min-h-0 min-w-0 flex-col gap-2.5 lg:h-full">
          <Sk className="h-[3.25rem] w-full rounded-[var(--radius)]" />

          <div className="flex gap-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Sk key={i} className="h-7 w-28 shrink-0 rounded-full" />
            ))}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
            {/* Itens */}
            <div className="min-h-[120px] flex-1 px-2 py-1.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-2">
                  <Sk className="h-10 w-10 shrink-0 rounded-[var(--radius-sm)]" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Sk className="h-3.5 w-2/3" />
                    <Sk className="h-3 w-1/4" />
                  </div>
                  <Sk className="h-8 w-20 shrink-0 rounded-full" />
                  <Sk className="h-4 w-12 shrink-0" />
                </div>
              ))}
            </div>

            {/* Rodapé da venda */}
            <div className="border-t border-line px-4 pb-3 pt-2.5">
              <div className="flex min-h-[2rem] items-center gap-2">
                <Sk className="h-4 w-40" />
              </div>
              <div className="flex items-end justify-between pb-2.5 pt-1">
                <Sk className="h-3 w-12" />
                <Sk className="h-10 w-32" />
              </div>
              <Sk className="h-14 w-full rounded-[var(--radius)]" />
            </div>
          </div>
        </section>

        {/* ── Lateral: caixa + fila do autoatendimento ── */}
        <div className="flex min-h-0 flex-col gap-2.5 lg:h-full">
          <Sk className="h-11 w-full rounded-full" />

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
            <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
              <Sk className="h-3 w-28" />
              <Sk className="h-7 w-7 rounded-full" />
            </div>
            <div className="flex flex-col gap-1.5 px-3.5 py-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Sk key={i} className="h-20 w-full rounded-[var(--radius)]" />
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (prefers-reduced-motion: reduce) { .animate-pulse { animation: none } }
      `}</style>
    </div>
  );
}
