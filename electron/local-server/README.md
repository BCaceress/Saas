# Servidor local do PDV (Node + SQLite) — blueprint

⚠️ **Scaffold.** Aqui vive a base do **offline 100%** (carregar a tela sem rede),
que a Fase 3 (v1, IndexedDB no navegador) ainda não cobre. É uma fase própria e
pesada — este diretório traz o schema estável (`db.js`) e o plano de fiação.

## Papel

No Electron, o `main` roda este servidor local. O renderer (React do PDV) deixa
de falar direto com o Neon e passa a falar com o **local**, que:

1. **Espelha o catálogo** do servidor central em SQLite (`catalog_produtos`) —
   assim a tela monta o carrinho e resolve preço sem rede.
2. **Enfileira vendas offline** (`pending_sales`, idempotência por `client_id`,
   mesmo shape de `sincronizarVendaOfflineAction`).
3. **Sincroniza** com o central quando há rede (empurra a fila, puxa catálogo).

```
Renderer ──IPC──▶ main (local-server)
                    ├─ SQLite (catálogo espelhado + fila + estado)
                    └─ sync ──HTTP──▶ servidor central (Neon)   (quando online)
```

## O que já existe

- `db.js` — SQLite (better-sqlite3): schema (`catalog_produtos`, `cash_session`,
  `pending_sales`, `sync_state`) + operações (upsert/list/enqueue/remove/state).

## O que falta (a fase pesada)

1. **Bridge IPC** — expor no preload um `window.pdvLocal` (produtos, enfileirar
   venda, listar pendentes) espelhando o padrão do `window.tef`.
2. **Rearquitetar a leitura do PDV** — o renderer lê o catálogo do local (hoje
   vem de props RSC). É a maior mudança: hoje o PDV é RSC; para 100% offline a
   listagem de produtos precisa vir do local (SQLite), não do servidor.
3. **Sync worker no main** — puxar catálogo (delta por `atualizado_em`) e
   empurrar `pending_sales` para `sincronizarVendaOfflineAction` (já existe,
   idempotente). Migrar a fila de IndexedDB (Fase 3) para cá no desktop.
4. **Servir a shell offline** — empacotar o Next standalone e servi-lo do main
   (hoje o app carrega `PDV_URL` de um servidor externo). Sem isso, um reload
   offline ainda não renderiza.

## Dependência

`better-sqlite3` (síncrono). Recompilar para o ABI do Electron após instalar:

```bash
npm i better-sqlite3
npx electron-rebuild -f -w better-sqlite3
```
