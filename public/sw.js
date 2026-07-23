// Service worker do NoHub (Fase 0 — resiliência).
//
// Objetivo modesto e SEGURO: acelerar o carregamento e dar uma página offline
// decente quando a rede cai. NÃO cacheia HTML autenticado (risco de servir a
// página de outro operador num aparelho compartilhado) e NÃO toca em mutações.
//
// - GET de assets estáticos e imutáveis do Next (/_next/static) → cache-first.
// - Navegações (documentos) → rede; ao falhar, serve /offline.html (estático).
// - POST (Server Actions), /api/*, outras origens → passa direto, sem interferir.
//
// Vender offline de verdade (carrinho/fila local) é fase posterior — aqui é só
// não perder o shell e avisar com elegância.

const VERSION = "v1";
const STATIC_CACHE = `nohub-static-${VERSION}`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.add(OFFLINE_URL);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // limpa versões antigas
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Mutações (Server Actions são POST) e não-GET: nunca interferir.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // outra origem: ignora
  if (url.pathname.startsWith("/api/")) return; // dados/webhooks: sempre rede

  // Assets imutáveis do Next → cache-first (URL já tem hash de versão).
  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/favicon.ico") {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Navegações → rede; ao falhar, página offline estática (não cacheia o HTML).
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(STATIC_CACHE);
        return (await cache.match(OFFLINE_URL)) ?? Response.error();
      }),
    );
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}
