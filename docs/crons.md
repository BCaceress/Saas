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
| `/api/jobs/alertas-push` | `0 12 * * *` (09h BRT) | push (1× em vez de 2×) |

`/api/jobs/diario` é só um dispatcher: chama as mesmas funções de lib das rotas
individuais, isola falha por job e devolve 200 com `falhas: n` no corpo — 5 de 6
jobs OK não deve marcar o cron como quebrado. As sete rotas individuais
**continuam existindo** e podem ser chamadas à mão a qualquer momento.

Custo dessa escolha: fila fiscal e sync de catálogo perdem granularidade (1×/dia
em vez de 10 min / 1 h). Aceitável em teste porque ambos têm caminho primário
(polling do PDV e sync sob demanda na tela do fornecedor).

## Voltar ao agendamento real

Quando o projeto virar **Pro** (40 crons, precisão de minuto):

1. Copie o bloco `crons` de `vercel.crons.pro.json` para `vercel.json`.
2. Apague `src/app/api/jobs/diario/` e `vercel.crons.pro.json`.
3. Deploy. As sete rotas já estão prontas — nada mais muda.

## Alternativa sem upgrade

Se precisar da fila fiscal a cada 10 min ainda no grátis, use um agendador HTTP
externo (cron-job.org, EasyCron) apontando para as rotas individuais com o header
`Authorization: Bearer $CRON_SECRET`. Evite GitHub Actions para isso: em repo
privado, `*/10 * * * *` consome ~4.300 min/mês contra 2.000 grátis.

## Testar à mão

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/jobs/diario
curl -H "Authorization: Bearer $CRON_SECRET" "https://<host>/api/jobs/snapshot-estoque?data=2026-08-06"
curl -H "Authorization: Bearer $CRON_SECRET" "https://<host>/api/jobs/alertas-push?agora=1"
```

Em desenvolvimento (`NODE_ENV !== production`) o header é dispensável.
