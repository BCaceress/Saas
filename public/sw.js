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

const VERSION = "v4";
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

      // Navigation preload: o browser dispara a requisição da navegação EM
      // PARALELO com o boot deste worker, em vez de esperar ele acordar para só
      // então chamar `fetch`. Um SW parado leva dezenas a centenas de ms para
      // subir num celular modesto, e esse tempo entrava em TODA navegação do /m
      // sem contrapartida nenhuma — aqui as navegações vão direto para a rede.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }

      await self.clients.claim();
    })(),
  );
});

// Permite que a página force a troca imediata quando há uma versão esperando
// (usado pelo aviso de "nova versão disponível" no cliente).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Mutações (Server Actions são POST) e não-GET: nunca interferir.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // outra origem: ignora
  if (url.pathname.startsWith("/api/")) return; // dados/webhooks: sempre rede


  // Assets imutáveis do Next → cache-first (URL já tem hash de versão).
  // /wasm/ entra junto: é o leitor de código de barras (~1 MB) que só o iOS
  // baixa. Sem cache, desceria a cada consulta na gôndola.
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/wasm/") ||
    url.pathname === "/favicon.ico"
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Navegações → rede; ao falhar, página offline estática (não cacheia o HTML).
  // Vale para TUDO, incluindo /m/* e /totem: celular do balcão e tablet de
  // quiosque trocam de operador o dia inteiro, e essas telas mostram custo e
  // número de venda. Se um dia alguém for cachear HTML aqui, precisa abrir
  // exceção explícita para essas rotas.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          // A resposta que o browser já começou a buscar enquanto este worker
          // subia. `undefined` quando o navegador não suporta preload — aí é o
          // `fetch` de sempre.
          const preload = await event.preloadResponse;
          if (preload) return preload;
          return await fetch(request);
        } catch {
          const cache = await caches.open(STATIC_CACHE);
          return (await cache.match(OFFLINE_URL)) ?? Response.error();
        }
      })(),
    );
  }
});

// ── Push ────────────────────────────────────────────────────
// O servidor manda o JSON montado em lib/alertas/push.ts. Nada de decidir
// texto aqui: o SW não sabe de permissão nem de tenant.

self.addEventListener("push", (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = {};
  }

  const titulo = dados.titulo || "NoHub Market";
  const url = dados.url || "/m/alertas";

  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: dados.corpo || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-monochrome.png",
      // A tag é o ID do alerta: o sistema COLAPSA a repetição em vez de
      // empilhar cinco avisos do mesmo produto na gaveta.
      tag: dados.tag || "nohub",
      renotify: false,
      // Crítico fica na tela até alguém tocar; o resto some sozinho.
      requireInteraction: dados.prioridade === "critico",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || "/m/alertas";

  event.waitUntil(
    (async () => {
      // Sem isto, tocar na notificação abre uma SEGUNDA instância do app por
      // cima da que já estava aberta — e a pessoa perde o que estava fazendo.
      const janelas = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const janela of janelas) {
        if (new URL(janela.url).origin !== self.location.origin) continue;
        await janela.focus();
        if ("navigate" in janela) await janela.navigate(destino).catch(() => {});
        return;
      }
      await self.clients.openWindow(destino);
    })(),
  );
});

// O Chrome rotaciona o endpoint de tempos em tempos. Sem reinscrever, a
// inscrição morre em silêncio e o aparelho simplesmente para de receber.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const anterior = event.oldSubscription || (await self.registration.pushManager.getSubscription());
      const chave = anterior && anterior.options && anterior.options.applicationServerKey;
      if (!chave) return;

      const nova = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: chave,
      });

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(nova.toJSON()),
      }).catch(() => {});
    })(),
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}
