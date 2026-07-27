# PDV — TEF + Offline (decisão de arquitetura e plano)

Decisões travadas (2026-07-23):

| Eixo | Decisão | Consequência |
|------|---------|--------------|
| **Runtime do PDV na loja** | **App desktop (Electron)** | Fala com pinpad/DLL nativo e roda servidor local → resolve TEF **e** offline no mesmo runtime. |
| **Gerenciador TEF** | **A escolher** (recomendação: PayGo Integrado) | Desenho adapter-agnóstico: trocar PayGo↔SiTef = trocar adapter, sem tocar no PDV. |
| **Cartão offline** | **Não** — só dinheiro offline | Cartão exige adquirente online. Sem captura tardia/store-and-forward: muito menos risco e complexidade. |

O PDV web atual **continua existindo** (acesso rápido, telas sem caixa). O
Electron **embrulha o mesmo app React** e adiciona duas capacidades que o
navegador não tem: TEF (pinpad) e servidor local (offline).

---

## Arquitetura alvo

```
┌─────────────────────────── Electron (máquina do caixa) ───────────────────────────┐
│                                                                                    │
│  Renderer (o MESMO React do PDV)                                                   │
│    • window.tef  ← ponte IPC para o pinpad        (src/lib/tef/ipc.ts)             │
│    • fala com o servidor LOCAL (não direto com o Neon)                             │
│                                                                                    │
│  Main (Node)                                                                       │
│    • Adapter TEF: PayGo (HTTP localhost) ou SiTef (CliSiTef DLL)  (implementa      │
│      TefProvider — src/lib/tef/types.ts)                                           │
│    • Servidor local: Next standalone OU um servidor Node leve, com um Postgres/    │
│      SQLite local como cache-fila                                                  │
│    • Sincronizador: empurra vendas offline ao servidor central quando há rede     │
│                                                                                    │
└────────────────────────────────────────────────────────────────────────────────────┘
                                   │  (quando online)
                                   ▼
                        Servidor central (Neon) — verdade de estoque/fiscal
```

Princípios:

- **TEF é local.** O adapter roda no **main** do Electron, nunca no servidor
  Next — o pinpad está na máquina. O renderer chama `window.tef`
  (`src/lib/tef/ipc.ts`); o preload encaminha por IPC ao main.
- **TEF é dois-fases.** `pagar` autoriza (PENDENTE) → grava a venda →
  `confirmar`; se a gravação falhar → `desfazer`. Codificado em `TefProvider`.
- **Offline é local-first para dinheiro.** A venda em dinheiro fecha contra um
  cache local e entra numa fila; sincroniza quando a rede volta. Cartão (TEF ou
  PSP) exige rede — a UI esconde/desabilita cartão offline.

---

## O que JÁ foi feito (scaffold estável, neste ciclo)

- **Contrato TEF** — `src/lib/tef/types.ts` (`TefProvider`, `TefResultado`,
  dois-fases: pagar/confirmar/desfazer/cancelar).
- **Ponte IPC** — `src/lib/tef/ipc.ts` (`window.tef`/`TefBridge`,
  `tefDisponivel()`, canais `TEF_IPC`).
- **Adapter simulado** — `src/lib/tef/simulado.ts` (aprova sempre, dados
  fictícios; roda sem hardware, exercita o fluxo e a NFC-e).

Esses três independem da escolha PayGo/SiTef e do empacotamento Electron — são a
fundação que os dois lados compartilham.

**Fase 0 — resiliência web (feita):**
- `useOnline` (`src/lib/hooks/use-online.ts`): evento do navegador + ping ao
  servidor. Banner "sem conexão" no PDV (`_client.tsx`).
- Rascunho local: carrinho/cliente/+18 salvos em `localStorage` por loja e
  restaurados ao recarregar/travar (não perde a venda em andamento).
- Service worker (`public/sw.js` + `sw-register.tsx`): cache-first dos assets do
  Next, página `public/offline.html` como fallback de navegação. **Não** cacheia
  HTML autenticado nem mutações (Server Actions passam direto).

**Fase 1 — empacotamento Electron com TEF simulado (scaffold):**
- `electron/main.js` (janela + handlers IPC do TEF), `electron/preload.js`
  (expõe `window.tef`), `electron/tef-simulado.js` (adapter simulado CJS),
  `electron/tef-channels.js` (espelho de `TEF_IPC`).
- `electron-builder.yml` (alvo Windows/nsis) + scripts `electron:dev` /
  `electron:build` + devDeps (electron, electron-builder, concurrently, wait-on).
- Como rodar: `electron/README.md`.
- **Falta fechar a Fase 1:** `npm install` das novas devDeps (electron é
  pesado, não instalado aqui) e empacotar o Next standalone dentro do executável
  (hoje carrega o Next servido via `PDV_URL`).

O modelo de dados **já comporta** o pagamento de cartão TEF sem migração nova: a
`Payment` tem `gateway` (string livre → `"TEF"`), `bandeira`, `parcelas`, `nsu`,
`autorizacao`, `adquirenteCnpj`. Falta só guardar o comprovante (ver Fase 2).

---

## Plano por fases

### Fase 0 — Resiliência web (rápida, independe do Electron) — ~2-3 dias
Baixo risco, entrega valor antes do Electron ficar pronto.

- Service worker + cache do catálogo (produtos/preço/EAN/saldo) em IndexedDB.
- Banner "sem conexão" via `navigator.onLine`; persistir o carrinho em
  `localStorage` (já existe o padrão `suspensa`).
- **Não** vende offline ainda — só não perde o que está na tela.

### Fase 1 — Empacotar o PDV em Electron — ~1 semana
- Novo pacote (monorepo ou `apps/desktop`): Electron + preload + carregar o app
  Next (dev: URL local; prod: Next standalone embutido ou servido no main).
- Preload expõe `window.tef` implementando `TefBridge` (por ora ligado ao
  **simulado** — sem hardware).
- Instalador Windows (electron-builder) + auto-update. Assinatura de código.
- **Entregável:** o PDV roda como app, idêntico ao web, com TEF simulado.

### Fase 2 — TEF real (cartão via pinpad)

**Parte provider-agnóstica FEITA** (roda com o simulado, sem hardware):
- `Payment.comprovante` (migração aplicada) + `gateway="TEF"` reusa
  bandeira/parcelas/nsu/autorizacao/adquirenteCnpj.
- `NovoPagamento.detalheCartao` → `criarVenda` grava o detalhe do TEF junto.
- `finalizarVendaTefCartaoAction` — grava a venda paga por TEF, **idempotente
  por tefId** (reenvio não duplica), finaliza (baixa + NFC-e com grupo `card`,
  `tp_integra=1`).
- Fluxo cliente `pagarCartaoTef` (_client.tsx): **dois-fases** —
  `window.tef.pagar` → grava a venda → `confirmar`; se a gravação falha,
  `desfazer`. `TefCartaoPanel` no modal (parcelas + "Enviar ao pinpad"); quando
  `tefDisponivel()`, o cartão vai ao TEF em vez do PSP de nuvem.
- Estorno TEF: `_historico` cancela no pinpad (`window.tef.cancelar`) antes do
  estorno da venda; o servidor pula pagamentos `gateway="TEF"` (não alcança o
  pinpad).

**Falta (bloqueado pela escolha do gerenciador):**
- Adapter real no Electron main (PayGo HTTP localhost **ou** SiTef/CliSiTef DLL)
  implementando `TefProvider` — hoje `electron/tef-simulado.js`.
- Impressão do comprovante armazenado (`Payment.comprovante`) na térmica
  (hoje guardado; o pinpad costuma imprimir a própria via).
- `resolverPendencias` na abertura do caixa (Fase 4).

Plano original abaixo (referência):
- Implementar o adapter escolhido no main:
  - **PayGo Integrado:** cliente HTTP em `http://localhost` (o Cliente PayGo roda
    como serviço) → mais direto.
  - **SiTef:** binding para a **CliSiTef** (DLL) via `node-ffi`/addon nativo.
- Fluxo no PDV (renderer): forma de pagamento "Cartão (TEF)" quando
  `tefDisponivel()`; `pagar` → grava a venda → `confirmar`/`desfazer`.
- **Comprovante:** `TefResultado` traz `comprovanteCliente/Loja`. Adicionar
  `Payment.comprovante String?` (migração) e imprimir junto do cupom (a mesma
  impressora térmica; ver a rota `/api/vendas/[saleId]/cupom`).
- **Estorno:** o estorno da venda (já existe) passa a chamar `tef.cancelar` para
  pagamentos `gateway = "TEF"`, além do estorno PSP para os de nuvem.
- NFC-e: o grupo `card` já é montado de `bandeira/autorizacao/adquirenteCnpj` —
  TEF preenche os mesmos campos, com `tp_integra = 1`.

### Fase 3 — Venda offline (dinheiro)

**FEITA (v1, local-first no navegador — funciona em web e Electron):**
- `Sale.clientId @unique` (migração aplicada) — chave de idempotência.
- Fila local: `src/lib/offline/fila-vendas.ts` (IndexedDB puro, sem dep).
- Ao fechar sem rede, `finalizar` (_client.tsx) enfileira em vez de chamar o
  servidor; **só dinheiro** (o modal restringe a DINHEIRO offline).
- Worker de sync: ao (re)conectar (`useOnline`), drena a fila →
  `sincronizarVendaOfflineAction` (idempotente por clientId, `paidAt` = hora
  real da venda). Um erro numa venda não trava as outras (continua).
- NFC-e: sai pelo hook fiscal normal na sincronização (CONTINGENCIA se a SEFAZ
  não responder — mecanismo já existente).
- UI: banner offline com contador "N na fila" + chip "Sincronizando…" ao voltar.

**Premissa do v1:** a página do PDV já está carregada (o caixa abriu online). Se
o operador **recarregar** offline, o app não carrega (o SW serve `offline.html`)
— mas a fila em IndexedDB sobrevive e drena quando ele reconecta e reabre. Rodar
100% offline (inclusive carregar a tela) exige o servidor local embutido no
Electron (Fase 1 pendente) + cache de catálogo.

**Falta:** cache de catálogo em IndexedDB (hoje o catálogo vem via props RSC, só
disponível se a tela carregou online); reconciliação de estoque/relatório
(Fase 4). Plano original abaixo:

### Fase 3 (original) — Venda offline (dinheiro) — ~1-2 semanas
- **Cache/fila local** no main (SQLite ou Postgres local): catálogo espelhado +
  `PendingSale` (itens, pagamentos em dinheiro, cpfNota, `clientId` único).
- **Preço isomórfico:** extrair `resolvePreco` (`src/lib/vendas.ts`) para um
  módulo que rode no renderer sobre o cache.
- **Sincronização:** ao voltar a rede, empurra cada `PendingSale` para
  `sincronizarVendaOfflineAction(clientId, payload)` — **idempotente por
  `clientId`** (`Sale.clientId @unique`, migração). O servidor recria a venda,
  aplica baixa, enfileira a NFC-e.
- **Fiscal offline:** NFC-e sai em `CONTINGENCIA` (mecanismo já existe no
  fiscal) e transmite na volta da rede.
- **Cartão offline:** bloqueado por decisão — a UI mostra "cartão indisponível
  sem conexão"; só dinheiro fecha offline.

### Fase 4 — Conflitos e caixa

**Reconciliação de estoque FEITA** (era um bug da Fase 3, não só melhoria):
- `finalizarVenda` / `aplicarBaixaItem` ganharam `permitirSaldoNegativo`;
  `sincronizarVendaOfflineAction` passa `true`. Venda offline cujo saldo mudou
  no meio-tempo agora **grava** (estoque vai a negativo = a verdade) e marca o
  razão ("Venda offline: saldo insuficiente — reconciliar"), em vez de lançar e
  **travar a fila para sempre** (o dinheiro já entrou). O negativo aparece nas
  telas de estoque; o operador reconcilia.

**Falta (maior / depende do servidor local):**
- **Cache de catálogo em IndexedDB:** só rende junto do servidor local embutido
  no Electron (sem ele, um reload offline não renderiza a tela RSC de qualquer
  forma). Adiar até a Fase de servidor local.
- **Caixa offline:** abrir/fechar caixa e sangria/suprimento sem rede — hoje
  exigem servidor. Nicho; adiar.
- **Fechamento TEF:** `TefProvider.resolverPendencias` na abertura do caixa —
  vai junto do adapter TEF real (resto da Fase 2).
- **NFC-e de venda offline sincronizada tarde:** hoje emite no horário do sync.
  Outage longo → a nota fica "atrasada"; o certo é CONTINGENCIA (tp_emis 9) com
  a data real. Precisa de decisão fiscal/contador — fora do escopo cash offline.
- **Servidor local no Electron** (Next standalone embutido) — o que fecha o
  "100% offline, inclusive carregar a tela". Fase própria, pesada.

---

## Riscos e mitigações

| Risco | Mitigação |
|------|-----------|
| Dinheiro autorizado no TEF sem venda gravada | Dois-fases obrigatório: `confirmar` só após persistir; `desfazer` na falha. |
| Venda duplicada na sincronização offline | `clientId @unique` — sincronização idempotente. |
| Estoque negativo temporário (offline) | Aceitar e reconciliar; servidor é a verdade; nunca travar a venda offline. |
| CliSiTef/DLL só em Windows | Electron no Windows (é o público de caixa); addon nativo por plataforma. |
| Nota fiscal offline | `CONTINGENCIA` (já implementado) transmite depois; monitorar a fila. |
| Manutenção de dois runtimes (web + desktop) | Mesmo código React; só o main/preload é específico do desktop. |

---

## Esforço total

- Fase 0: ~2-3 dias · Fase 1: ~1 semana · Fase 2: ~1-2 semanas (após escolher o
  gerenciador) · Fase 3: ~1-2 semanas · Fase 4: ~1 semana.
- **Realista: ~6-8 semanas** para TEF real + offline de dinheiro confiável.

## Próximas decisões (destravar antes de Fase 2/3)

1. **Gerenciador TEF** (PayGo x SiTef) + contrato de adquirente — trava a Fase 2.
2. **Servidor local**: Next standalone embutido x servidor Node leve + SQLite —
   trava a Fase 3.
3. **Pipeline de build/assinatura** do instalador Windows — trava a Fase 1.

Recomendação de ordem: **Fase 0 → Fase 1 (com TEF simulado) → escolher
gerenciador → Fase 2 → Fase 3 → Fase 4.** Fase 0 entrega valor imediato; Fase 1
prova o empacotamento sem depender de hardware; as fases pesadas só começam com
as decisões acima travadas.
