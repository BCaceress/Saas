# NoHub PDV — desktop (Electron)

Runtime nativo do PDV. Existe para o que o navegador não faz: **TEF** (pinpad)
e, nas próximas fases, **servidor local** (venda offline). Carrega o MESMO app
React do PDV — aqui só ficam o processo principal e a ponte nativa.

## Arquivos

| Arquivo | Papel |
|---|---|
| `main.js` | Processo principal: cria a janela, registra os handlers IPC do TEF. |
| `preload.js` | Expõe `window.tef` ao renderer (contextIsolation ligado). |
| `tef-simulado.js` | Adapter TEF simulado (dev/sem hardware). |
| `tef-sitef.js` | Adapter **SiTef** (CliSiTef via FFI) — scaffold; exige DLL + contrato. |
| `tef-channels.js` | Nomes dos canais IPC — espelho de `src/lib/tef/ipc.ts`. |
| `local-server/` | Servidor local Node+SQLite (offline 100%) — blueprint + schema. |

## Escolher o adapter TEF

`TEF_PROVIDER=sitef` usa o CliSiTef (produção); qualquer outro valor = simulado.
Config do SiTef por env: `SITEF_DLL_PATH`, `SITEF_IP` (servidor SiTef),
`SITEF_LOJA`, `SITEF_TERMINAL`, `SITEF_OPERADOR`. Ver `tef-sitef.js` — é scaffold:
o laço interativo do CliSiTef e os códigos de campo (NSU/autorização/bandeira)
têm TODOs a preencher pelo manual da Software Express, com a DLL em mãos.

Instalar o FFI: `npm i koffi`.

O contrato TEF e a ponte tipada do lado do renderer estão em `src/lib/tef/`.

## Rodar (dev)

```bash
npm install            # baixa electron, electron-builder, concurrently, wait-on
npm run electron:dev   # sobe o Next dev e abre o app quando o :3000 responde
```

Ou, com o `next dev` já rodando:

```bash
npm run electron       # abre o app apontando para http://localhost:3000/vendas
```

`PDV_URL` sobrescreve a URL carregada (ex.: subdomínio de loja com `lvh.me`).

## Testar o TEF simulado

No renderer (DevTools do app), `window.tef` está disponível:

```js
await window.tef.pagar({ valor: 42.9, tipo: "CREDITO", parcelas: 1, referencia: "#TESTE" });
// → { status: "APROVADO", bandeira: "MASTERCARD", nsu, autorizacao, comprovanteCliente, tefId, ... }
```

Fora do Electron (navegador comum), `window.tef` é `undefined` — o PDV detecta
com `tefDisponivel()` e esconde o cartão TEF.

## Empacotar (Windows)

```bash
npm run electron:build   # electron-builder → dist-desktop/
```

**Limite da Fase 1:** o app carrega o Next JÁ SERVIDO (`PDV_URL`). Empacotar o
Next standalone dentro do executável (rodar sem servidor externo) + assinatura
de código + auto-update são o fechamento da Fase 1 / entram na Fase 3. Ver
`docs/pdv-pagamentos-roadmap.md`.
