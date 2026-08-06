import { cn } from "@/lib/utils";

/**
 * Carrossel de indicadores com scroll-snap. Formaliza o padrão que já existia
 * inline em `(app)/inicio/_kpi-row.tsx:53` — lá ele volta a ser grid em `sm:`,
 * aqui não: a superfície `/m` é só celular, então o carrossel é o estado final.
 *
 * Cada slide ocupa ~72% da largura de propósito: o pedaço do próximo card
 * aparecendo na borda é o que avisa que há mais para arrastar.
 *
 * O `-mx-3 px-3` cancela o padding do `<main>` para o carrossel sangrar até a
 * borda da tela, mas o primeiro e o último card continuarem alinhados ao resto
 * do conteúdo.
 */
export function KpiCarousel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "scrollbar-none -mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Um slide do carrossel. Envolva cada card com isto. */
export function KpiSlide({ children }: { children: React.ReactNode }) {
  return <div className="min-w-[72%] shrink-0 snap-start">{children}</div>;
}
