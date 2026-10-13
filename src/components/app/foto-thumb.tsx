"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

// ── Fila de miniaturas ───────────────────────────────────────────────────────

/**
 * Quantas miniaturas baixam ao mesmo tempo.
 *
 * As fotos da listagem saem da MESMA origem do app (`/_next/image` e
 * `/api/produtos/<id>/imagem`), e o navegador abre no máximo 6 conexões por
 * origem em HTTP/1.1. Uma página de 50 produtos ocupava as 6 com fotos e o
 * clique do operador — abrir a ficha, trocar o filtro, salvar — ficava na fila
 * atrás delas. Com 4, sobram sempre 2 para o que ele pedir.
 */
const SIMULTANEAS = 4;
/** Foto que não responde devolve a vez: host travado não pode parar a fila. */
const PRAZO_VEZ_MS = 8000;

let ativas = 0;
const fila: (() => void)[] = [];

/** Pede a vez de baixar. Devolve `largar`, que cancela a espera ou libera a vez. */
function entrarNaFila(aoLiberar: () => void): () => void {
  let fase: "espera" | "ativa" | "fim" = "espera";
  let prazo: ReturnType<typeof setTimeout> | undefined;

  const iniciar = () => {
    fase = "ativa";
    ativas++;
    prazo = setTimeout(largar, PRAZO_VEZ_MS);
    aoLiberar();
  };

  function largar() {
    if (fase === "fim") return;
    const eraAtiva = fase === "ativa";
    fase = "fim";
    if (!eraAtiva) {
      const i = fila.indexOf(iniciar);
      if (i >= 0) fila.splice(i, 1);
      return;
    }
    clearTimeout(prazo);
    ativas--;
    fila.shift()?.();
  }

  if (ativas < SIMULTANEAS) iniciar();
  else fila.push(iniciar);
  return largar;
}

/**
 * `useFoto` para listas: a `<img>` só ganha `src` quando chega perto da tela E
 * a fila dá a vez. Até lá o estado é "carregando" (o brilho de espera cobre).
 *
 * Substitui o `loading="lazy"` nativo — não dá para combinar os dois: uma foto
 * lazy fora da tela seguraria a vez sem nunca baixar.
 *
 * Espalhe `img` na `<img>` (já traz `src`, `ref`, `onLoad`, `onError`).
 */
export function useFotoEmFila(src: string) {
  const foto = useFoto(src);
  const [liberada, setLiberada] = useState<string | null>(null);
  const alvo = useRef<HTMLImageElement | null>(null);
  const largar = useRef<() => void>(() => {});

  useEffect(() => {
    const el = alvo.current;
    if (!el || !src) return;
    const io = new IntersectionObserver(
      (entradas) => {
        if (!entradas.some((e) => e.isIntersecting)) return;
        io.disconnect();
        largar.current = entrarNaFila(() => setLiberada(src));
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      largar.current();
      largar.current = () => {};
    };
  }, [src]);

  const pronta = liberada === src;
  const { ref: fotoRef, onLoad, onError } = foto.img;

  // Sem `src` a `<img>` já nasce `complete` com largura 0 — entregá-la ao
  // `useFoto` antes da vez marcaria "erro" numa foto que nem começou.
  const ref = useCallback(
    (el: HTMLImageElement | null) => {
      alvo.current = el;
      if (pronta) fotoRef(el);
    },
    [pronta, fotoRef],
  );

  return {
    estado: foto.estado,
    img: {
      ref,
      src: pronta ? src : undefined,
      onLoad: () => { largar.current(); onLoad(); },
      onError: () => { largar.current(); onError(); },
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
