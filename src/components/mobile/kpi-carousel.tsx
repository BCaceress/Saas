"use client";

import { Children, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Carrossel de indicadores com scroll-snap. Formaliza o padrão que já existia
 * inline em `(app)/inicio/_kpi-row.tsx:53` — lá ele volta a ser grid em `sm:`,
 * aqui não: a superfície `/m` é só celular, então o carrossel é o estado final.
 *
 * O `-mx-4 px-4` cancela o padding do `<main>` para o carrossel sangrar até a
 * borda da tela, mas o primeiro e o último card continuarem alinhados ao resto
 * do conteúdo. O `scroll-px-4` repete essa margem no encaixe: sem ele o card
 * do meio para colado na borda da tela, fora do alinhamento dos vizinhos.
 *
 * É client só por causa dos pontos de posição (`pontos`), que precisam do
 * scroll. Os cards continuam sendo renderizados no servidor e entram por
 * `children` — nada do peso deles atravessa a fronteira.
 */
export function KpiCarousel({
  children,
  pontos = false,
  className,
}: {
  children: React.ReactNode;
  /** Mostra os pontos de posição embaixo. Obrigatório quando os slides são de
   * largura cheia: sem o vizinho espiando na borda, nada mais diz que há mais
   * cards para o lado. */
  pontos?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [atual, setAtual] = useState(0);
  const total = Children.count(children);

  return (
    <div className={cn("space-y-2", className)}>
      <div
        ref={ref}
        onScroll={
          pontos
            ? (e) => {
                // O passo é a largura de um slide mais o vão — medida no DOM,
                // porque ela muda com `largura` e com o tamanho da tela.
                const el = e.currentTarget;
                const slide = el.firstElementChild as HTMLElement | null;
                const passo = (slide?.offsetWidth ?? el.clientWidth) + 8;
                const i = Math.round(el.scrollLeft / (passo || 1));
                setAtual(Math.max(0, Math.min(total - 1, i)));
              }
            : undefined
        }
        className="scrollbar-none -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 pb-1"
      >
        {children}
      </div>

      {pontos && total > 1 && (
        <div className="flex justify-center gap-1.5" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all duration-200",
                i === atual ? "w-4 bg-ink-2" : "w-1.5 bg-line-strong",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Um slide do carrossel. Envolva cada card com isto.
 *
 * `parcial` (padrão) deixa ~72% da tela por card: o pedaço do vizinho na borda
 * é o que avisa que há mais para arrastar. `cheia` dá a largura inteira do
 * conteúdo — para quando o número é a manchete da tela e nada pode dividir a
 * linha com ele; aí quem avisa do resto são os pontos de posição.
 */
export function KpiSlide({
  children,
  largura = "parcial",
}: {
  children: React.ReactNode;
  largura?: "parcial" | "cheia";
}) {
  return (
    <div
      className={cn(
        "shrink-0 snap-start",
        largura === "cheia" ? "min-w-full" : "min-w-[72%]",
      )}
    >
      {children}
    </div>
  );
}
