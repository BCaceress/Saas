"use client";

import { useSyncExternalStore } from "react";

/**
 * Responde a uma media query em React.
 *
 * `useSyncExternalStore` e não `useEffect` + `useState`: o tamanho da tela é
 * estado do navegador, e lê-lo num efeito para depois chamar `setState` gera
 * render em cascata (é o que a regra `react-hooks/set-state-in-effect` barra).
 *
 * No servidor devolve `false` — nenhum layout deve depender disso para o
 * primeiro render, só comportamento que só existe no cliente (qual teclado
 * mostrar, por exemplo).
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (aoMudar) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", aoMudar);
      return () => mq.removeEventListener("change", aoMudar);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Abaixo do breakpoint `sm` do Tailwind — a fronteira "celular na mão". */
export function useEhCelular(): boolean {
  return useMediaQuery("(max-width: 639px)");
}
