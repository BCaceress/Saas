# Testes — PDV, pagamentos, TEF, offline

Três níveis. O caminho de **dinheiro** (offline sync, idempotência, reconciliação,
estorno) é o que mais importa blindar — bug ali = prejuízo.

## Nível 1 — Unit (roda agora, sem banco nem hardware)

Vitest, funções puras + simulados. **Verde hoje.**

```bash
npm test            # roda tests/unit
npm run test:watch
```

Cobre:
- `tests/unit/bandeira.test.ts` — `normalizarBandeira` (→ tBand da NFC-e) e os
  CNPJs de credenciadora. Regressão de bandeira errada na nota.
- `tests/unit/tef-simulado.test.ts` — contrato TEF dois-fases (o simulado é o que
  permite testar o fluxo sem pinpad).
- `tests/unit/fila-offline.test.ts` — fila IndexedDB (idempotência/ordem/remoção)
  via `fake-indexeddb`.

Config: `vitest.config.ts` (apelida `server-only` → stub e `@` → src).

## Nível 2 — Integração (precisa de Postgres de teste)

Bate num banco real (NUNCA o de produção). Auto-pula sem `DATABASE_URL_TEST`.

```bash
DATABASE_URL=$DATABASE_URL_TEST DATABASE_URL_TEST=$DATABASE_URL_TEST \
  npm run test:integration
```

- `tests/integration/venda-offline.int.test.ts` — **template**: idempotência do
  sync por `clientId`, reconciliação (venda offline sem saldo grava + estoque
  negativo), NFC-e enfileirada. Falta um helper `seedTenantMinimo()` (tenant +
  site + produto + caixa) — extrair de `prisma/seed.ts`. Enquanto isso, os casos
  ficam em `it.skip` com o alvo descrito.

## Nível 3 — E2E (Playwright)

Fluxo real no navegador com os simulados (sem PSP/hardware).

```bash
npx playwright install     # 1ª vez
npm run test:e2e
```

- `tests/e2e/pdv-offline.spec.ts` — offline: banner → venda em dinheiro na fila →
  reconecta → sincroniza; cartão/PIX indisponíveis offline. **Em `test.fixme`**
  até existir um fixture de login (sessão autenticada + tenant semeado + caixa
  aberto). Config: `playwright.config.ts` (sobe `npm run dev`, base `lvh.me:3000`).

## Precisa de ambiente/hardware externo (fora do automatizado)

- **NFC-e real:** Nuvem Fiscal homologação + certificado A1 + CSC da SEFAZ
  (ambiente HOMOLOGACAO). Testa autorização/rejeição/contingência de verdade.
- **PSP (PIX/Point):** sandbox Mercado Pago / Stone `sk_test`.
- **SiTef:** `CliSiTef.dll` de homologação + credenciais Software Express +
  pinpad. Só aqui os TODOs de `electron/tef-sitef.js` viram código testável.

## Prioridade sugerida

1. Manter o Nível 1 verde no CI (barato, pega regressão fiscal/bandeira).
2. Completar o `seedTenantMinimo()` e ligar os testes de integração do sync —
   é o maior valor (dinheiro).
3. Fixture de login para destravar o E2E offline.
