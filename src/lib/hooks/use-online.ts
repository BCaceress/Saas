"use client";

import { useEffect, useState } from "react";

// ============================================================
// Estado de conexão do navegador. Base da resiliência offline (Fase 0):
// o PDV avisa quando cai a rede e desabilita o que exige servidor (cartão,
// integrações). `navigator.onLine` é otimista (só sabe da placa de rede, não
// se o servidor responde) — por isso, além do evento, um ping leve confirma.
// ============================================================

/** Ping barato a um recurso próprio; confirma que o servidor responde. */
async function pingServidor(signal: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch("/favicon.ico", { method: "HEAD", cache: "no-store", signal });
    return res.ok || res.status === 404; // respondeu = online (404 ainda é resposta)
  } catch {
    return false;
  }
}

export function useOnline(): boolean {
  // SSR/1º paint assume online — evita um flash de "offline" na hidratação.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let vivo = true;
    let controller: AbortController | null = null;

    const confirmar = async () => {
      // Evento do navegador é o gatilho; o ping é a verdade.
      controller?.abort();
      controller = new AbortController();
      const ok = await pingServidor(controller.signal);
      if (vivo) setOnline(ok);
    };

    const onOnline = () => confirmar();
    const onOffline = () => vivo && setOnline(false);

    // estado inicial: o próprio ping resolve (falha rápido se offline).
    confirmar();

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    // Reconfirma periodicamente: a rede pode voltar sem disparar "online".
    const id = window.setInterval(confirmar, 20_000);

    return () => {
      vivo = false;
      controller?.abort();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(id);
    };
  }, []);

  return online;
}
