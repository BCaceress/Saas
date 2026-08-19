import { NextResponse } from "next/server";
import { sincronizarCatalogosDevidos } from "@/lib/compras/sync";
import { autorizarCron } from "@/lib/cron";
import { processarFilaFiscalTodos } from "@/lib/fiscal/emissao";
import { sincronizarCaixasTodos } from "@/lib/fiscal/email-inbox";
import { sincronizarDistribuicaoTodos } from "@/lib/fiscal/distribuicao";
import { avaliarAssinaturas } from "@/lib/assinatura";
import { logErro } from "@/lib/log";
import { limparExpirados } from "@/lib/rate-limit";
import { limparTokensExpirados } from "@/lib/senha";
import { snapshotEstoqueTodos } from "@/lib/snapshot";

/**
 * Dispatcher diário — existe por causa do plano.
 *
 * O plano Hobby do Vercel aceita 2 crons por projeto e só 1×/dia. Os sete jobs
 * do sistema não cabem nesse orçamento, então esta rota roda seis deles em uma
 * passada única. É perda de granularidade consciente, não desenho ideal: a fila
 * fiscal deveria rodar a cada 10 min e o catálogo de hora em hora.
 *
 * Quando o projeto virar Pro, apague este arquivo e devolva os sete crons de
 * `vercel.crons.pro.json` ao `vercel.json` (ver `docs/crons.md`).
 *
 * Cada job é isolado: falha de um não impede os outros, e o resultado sai por
 * job para o log do Vercel dizer o que quebrou. Todos são idempotentes.
 */

export const runtime = "nodejs"; // fila fiscal e push usam crypto do Node
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Resultado = { job: string; ok: boolean; detalhe?: unknown; erro?: string };

async function passo(job: string, fn: () => Promise<unknown>): Promise<Resultado> {
  try {
    return { job, ok: true, detalhe: await fn() };
  } catch (e) {
    logErro(`job.diario.${job}`, e);
    return { job, ok: false, erro: e instanceof Error ? e.message : "Erro desconhecido." };
  }
}

async function executar(req: Request) {
  const negado = autorizarCron(req);
  if (negado) return negado;

  // Sequencial de propósito: seis jobs pesados em paralelo brigam pelas
  // mesmas conexões do pool do Neon.
  const resultados: Resultado[] = [];

  resultados.push(await passo("fila-fiscal", () => processarFilaFiscalTodos()));
  resultados.push(await passo("snapshot-estoque", () => snapshotEstoqueTodos(new Date())));
  resultados.push(
    await passo("assinaturas", async () => {
      const assinaturas = await avaliarAssinaturas();
      const [tokens, janelas] = await Promise.all([
        limparTokensExpirados(),
        limparExpirados(),
      ]);
      return { ...assinaturas, tokensRemovidos: tokens, janelasRemovidas: janelas };
    }),
  );
  resultados.push(await passo("sincronizar-catalogos", () => sincronizarCatalogosDevidos(50)));
  resultados.push(await passo("importar-nfe-email", () => sincronizarCaixasTodos()));
  resultados.push(await passo("distribuicao-sefaz", () => sincronizarDistribuicaoTodos()));

  const falhas = resultados.filter((r) => !r.ok);

  // 200 mesmo com falha parcial: o cron não deve ser marcado como quebrado
  // quando 5 de 6 jobs rodaram. O `falhas` no corpo é o sinal.
  return NextResponse.json({ ok: falhas.length === 0, falhas: falhas.length, resultados });
}

export const GET = executar;
export const POST = executar;
