"use client";

import { useEffect } from "react";

// Guarda a registration para quem precisa dela depois (push subscription).
// Um módulo simples em vez de contexto: quem pergunta são handlers de clique,
// não render — e o valor nunca muda depois de resolvido.
let registration: ServiceWorkerRegistration | null = null;

/** Registration do SW, ou null se ainda não registrou / não há suporte. */
export function getSWRegistration(): ServiceWorkerRegistration | null {
  return registration;
}

/** Espera o SW ficar pronto. Resolve null onde não há suporte. */
export async function readySWRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    registration = await navigator.serviceWorker.ready;
    return registration;
  } catch {
    return null;
  }
}

// Registra o service worker (public/sw.js) uma vez, no cliente. Em dev o SW
// atrapalha o HMR do Next, então fica desligado — a não ser com
// NEXT_PUBLIC_SW_DEV=1, que é como se testa PWA/push num celular real antes de
// subir. Falha de registro é silenciosa: é progressive enhancement, o app
// funciona sem ele.
export function ServiceWorkerRegister() {
  useEffect(() => {
    const devLiberado = process.env.NEXT_PUBLIC_SW_DEV === "1";
    if (process.env.NODE_ENV !== "production" && !devLiberado) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        registration = reg;
      })
      .catch(() => {
        // sem SW: o app segue normal, só perde o cache offline
      });
  }, []);

  return null;
}
