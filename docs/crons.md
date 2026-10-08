# Jobs agendados

Sete rotas em `src/app/api/jobs/*` fazem o trabalho que só o tempo decide. Todas
exigem `Authorization: Bearer $CRON_SECRET` e falham fechadas em produção sem o
segredo (`src/lib/cron.ts`). Todas são idempotentes — rodar duas vezes no mesmo
dia não duplica efeito.

| Rota | Ritmo desejado | O que faz | Se não rodar |
| --- | --- | --- | --- |
| `fila-fiscal` | 10 min | Rede de segurança da emissão de NFC-e. O caminho normal é o polling da tela do PDV empurrar a nota; o job pega o que ficou para trás (caixa fechado no meio, SEFAZ que voltou de madrugada, contingência). | Nota autorizada fica presa até a próxima passada. |
| `sincronizar-catalogos` | 1 h | Reescreve o catálogo dos fornecedores com integração por API cujo intervalo de sync venceu. | Tabela de preço fica velha; comparador de cesta decide com preço defasado. |
| `snapshot-estoque` | 1×/dia (04:10) | Grava `StockSnapshot`: saldo e valor por (produto × loja) de cada tenant ativo. | Relatórios históricos e curvas de evolução ficam com buraco naquele dia. |
| `assinaturas` | 1×/dia (12:00) | Avisa fim de teste, suspende vencido/estourado, reconsulta no Mercado Pago as assinaturas pendentes (webhook perdido não pode virar cliente pagando sem acesso). Aproveita para apagar token de senha vencido e janela de rate limit. | Cliente inadimplente continua com acesso; quem pagou pode ficar suspenso se o webhook falhou. |
| `importar-nfe-email` | 20 min | Varre as caixas IMAP configuradas em Configurações → Notas fiscais e importa o XML anexado pelos fornecedores. | A nota do fornecedor só entra por upload manual ou pela SEFAZ. |
| `distribuicao-sefaz` | 2×/dia | Consulta a distribuição DF-e de cada loja com certificado. Com ciência automática ligada, importa a nota completa sem clique. | Nota do fornecedor só entra por upload, e-mail ou consulta manual. |
| `alertas-push` | 11h e 21h | Dispara push nos aparelhos inscritos. Janela 7h–21h `America/Sao_Paulo`, validada dentro do job. Duas vezes ao dia de propósito: push de ERP que toca demais vira push desligado. | Alerta só aparece no sino, quando alguém abre o sistema. |

## Estado atual: plano Hobby (grátis)

O Hobby do Vercel aceita **2 crons por projeto, no máximo 1×/dia**. Sete crons
com schedule sub-diário fazem o deploy ser recusado — foi o que travou a
publicação automática em agosto/2026.

Arranjo em vigor no `vercel.json`:

| Cron | Schedule (UTC) | Cobre |
| --- | --- | --- |
| `/api/jobs/diario` | `0 7 * * *` (04h BRT) | fila-fiscal + snapshot-estoque + assinaturas + sincronizar-catalogos + importar-nfe-email + distribuicao-sefaz, em sequência |
| `/api/jobs/alertas-push` | `0 12 * * *` (09h BRT) | push da manhã (o da noite vem do GitHub Actions) |

`/api/jobs/diario` é só um dispatcher: chama as mesmas funções de lib das rotas
individuais, isola falha por job e devolve 200 com `falhas: n` no corpo — 5 de 6
jobs OK não deve marcar o cron como quebrado. As sete rotas individuais
**continuam existindo** e podem ser chamadas à mão a qualquer momento.

Schedule sub-diário no `vercel.json` faz o deploy ser **recusado** com link para
"Usage and pricing for cron jobs" — não é aviso, é erro de build. A granularidade
perdida pelo dispatcher volta pelo GitHub Actions (seção abaixo).

## Voltar ao agendamento real

Quando o projeto virar **Pro** (40 crons, precisão de minuto):

1. Copie o bloco `crons` de `vercel.crons.pro.json` para `vercel.json`.
2. Apague `src/app/api/jobs/diario/` e `vercel.crons.pro.json`.
3. Deploy. As sete rotas já estão prontas — nada mais muda.

## Agendador externo: GitHub Actions

`.github/workflows/jobs-agendados.yml` devolve o ritmo sub-diário sem upgrade.
Chama as rotas individuais por HTTP com o mesmo `CRON_SECRET`:

| Schedule (UTC) | Rotas |
| --- | --- |
| `*/30 10-23,0-5 * * *` (30 min, 07h–02h BRT) | `fila-fiscal`, `sincronizar-catalogos`, `importar-nfe-email` |
| `45 22 * * *` (19h45 BRT) | `alertas-push`, `distribuicao-sefaz` — fecham os 2×/dia desejados |

O disparo do fim do dia não pode passar das 20h BRT: a janela padrão do push
fecha em 21h **exclusivo** (`pushHoraFim`, `src/lib/alertas/push.ts`) e o job
sairia pulando todo tenant que não mexeu na configuração.

Também roda à mão: aba **Actions → Jobs agendados → Run workflow**, com a lista
de rotas no campo `rotas`.

Configure uma vez em **Settings → Secrets and variables → Actions**:

| Tipo | Nome | Valor |
| --- | --- | --- |
| Secret | `CRON_SECRET` | mesmo valor da env var do projeto no Vercel |
| Variable | `APP_BASE_URL` | `https://<host-de-produção>` (sem barra no fim) |

**Orçamento de minutos** — repo privado tem 2.000 min/mês grátis e o GitHub cobra
1 minuto cheio por run, mesmo que o curl leve 3 segundos:

| Schedule | Runs/mês | Minutos |
| --- | --- | --- |
| 30 min, 20h/dia | ~1.200 | ~1.200 |
| fim do dia | 30 | ~30 |
| **total** | | **~1.230 de 2.000** |

Não aumente a frequência sem refazer essa conta — foi o que matou a ideia de
`*/10 * * * *` (~4.300 min/mês). Se precisar de 10 min de verdade, troque por um
agendador HTTP que não cobra minuto (cron-job.org, EasyCron) apontando para as
mesmas rotas com o header `Authorization: Bearer $CRON_SECRET`.

Duas limitações aceitas: o schedule do GitHub atrasa alguns minutos (mais em
horário de pico) e é **desligado automaticamente se o repo ficar 60 dias sem
commit**. Nenhum job depende de pontualidade — todos são idempotentes e têm
caminho primário (polling do PDV, sync sob demanda na tela do fornecedor).

## Testar à mão

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/jobs/diario
curl -H "Authorization: Bearer $CRON_SECRET" "https://<host>/api/jobs/snapshot-estoque?data=2026-08-06"
curl -H "Authorization: Bearer $CRON_SECRET" "https://<host>/api/jobs/alertas-push?agora=1"
```

Em desenvolvimento (`NODE_ENV !== production`) o header é dispensável.
