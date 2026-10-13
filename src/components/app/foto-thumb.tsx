"use client";

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";

type Estado = "carregando" | "ok" | "erro";

/**
 * Acompanha o carregamento de uma `<img>`: carregando → ok | erro.
 *
 * O `ref` cobre a foto que terminou ANTES da hidratação (cache do navegador):
 * nesse caso o `onLoad` já disparou sem ninguém ouvindo e o estado ficaria em
 * "carregando" para sempre.
 *
 * O estado guarda o `src` a que se refere — trocar a foto volta para
 * "carregando" sem efeito nem `key`.
 */
export function useFoto(src: string) {
  const [st, setSt] = useState<{ src: string; estado: Estado }>({ src, estado: "carregando" });
  const estado: Estado = st.src === src ? st.estado : "carregando";

  const ref = useCallback(
    (el: HTMLImageElement | null) => {
      if (el?.complete) setSt({ src, estado: el.naturalWidth > 0 ? "ok" : "erro" });
    },
    [src],
  );

  return {
    estado,
    img: {
      ref,
      onLoad: () => setSt({ src, estado: "ok" }),
      onError: () => setSt({ src, estado: "erro" }),
    },
  };
}

/**
 * Brilho de espera da miniatura — o mesmo `.sk-shimmer` das linhas de
 * placeholder, para a foto que ainda não chegou falar a língua do resto da
 * tela. O pai precisa ser `relative` e ter `overflow-hidden`.
 */
export function FotoEspera({ className }: { className?: string }) {
  return <span aria-hidden className={cn("sk-shimmer absolute inset-0", className)} />;
}

/** Classes da `<img>` conforme o estado: invisível até carregar, depois fade curto. */
export const fotoClasse = (estado: Estado) =>
  cn(
    "transition-opacity duration-200 motion-reduce:transition-none",
    estado === "ok" ? "opacity-100" : "opacity-0",
  );
