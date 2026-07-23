"use client";

import { useEffect } from "react";

// Registra o service worker (public/sw.js) uma vez, no cliente. Só em produção:
// em dev o SW atrapalha o HMR do Next. Falha de registro é silenciosa — é
// progressive enhancement, o app funciona sem ele.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // sem SW: o app segue normal, só perde o cache offline
    });
  }, []);

  return null;
}
