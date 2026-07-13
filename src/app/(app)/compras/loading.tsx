import { Sk, SkPageHeader } from "@/components/app/skeletons";

/** Skeleton de compras: cabeçalho + resumo em linha + bloco Reposição + cards em andamento. */
export default function ComprasLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-busy="true" aria-label="Carregando compras">
      <SkPageHeader actions={3} />

      {/* Resumo operacional em uma linha */}
      <Sk className="h-11 w-full rounded-2xl" />

      {/* Bloco Reposição: título + prévia de produtos */}
      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <Sk className="h-3 w-20" />
            <Sk className="h-5 w-64 max-w-[60vw]" />
            <Sk className="h-3.5 w-48" />
          </div>
          <Sk className="h-9 w-40 rounded-full" />
        </div>
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Sk className="h-8 w-8 rounded-lg" />
              <Sk className="h-4 w-52 max-w-[40vw]" />
              <Sk className="ml-auto h-4 w-24" />
            </div>
          ))}
        </div>
      </div>

      {/* Em andamento: cards horizontais */}
      <div className="flex flex-col gap-2.5">
        <Sk className="h-3 w-28" />
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 rounded-2xl border border-line bg-surface px-4 py-3">
            <Sk className="h-9 w-9 rounded-xl" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Sk className="h-4 w-40 max-w-[40vw]" />
              <Sk className="h-3 w-56 max-w-[55vw]" />
            </div>
            <Sk className="h-9 w-32 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
