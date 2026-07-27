import { Sk, SkPageHeader } from "@/components/app/skeletons";

/**
 * Skeleton da tela de contagem — mostra na hora do clique em "Iniciar"/
 * "Continuar contagem", antes do servidor buscar o inventário. Espelha
 * ContagemView: cabeçalho, barra de progresso, busca e linhas de item.
 */
export default function ContagemLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy="true" aria-label="Carregando contagem">
      <SkPageHeader actions={1} />

      <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-5">
        <div>
          <div className="flex items-center justify-between">
            <Sk className="h-3 w-40" />
            <Sk className="h-3 w-20" />
          </div>
          <Sk className="mt-1.5 h-1.5 w-full rounded-full" />
        </div>

        <Sk className="h-9 w-full rounded-[var(--radius)]" />

        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-[var(--radius)] bg-surface-2 px-3 py-2.5">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Sk className="h-3.5 w-1/3" />
                <Sk className="h-3 w-1/4" />
              </div>
              <Sk className="h-8 w-24 shrink-0 rounded-[var(--radius)]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
