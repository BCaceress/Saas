import { NextResponse } from "next/server";
import { avaliarAssinaturas } from "@/lib/assinatura";
import { autorizarCron } from "@/lib/cron";
import { logErro } from "@/lib/log";
import { limparExpirados } from "@/lib/rate-limit";
import { limparTokensExpirados } from "@/lib/senha";

/**
 * Job diário de cobrança e faxina.
 *
 * Faz o que só o tempo decide: avisa quem está no fim do teste, suspende quem
 * venceu ou estourou a tolerância, e reconsulta no gateway as assinaturas
 * pendentes — webhook perdido não pode significar cliente pagando sem acesso.
 *
 * Aproveita a passada para apagar token de senha vencido e janela de rate
 * limit expirada: tabela de controle que só cresce vira custo silencioso.
 *
 * Agendamento: 1×/dia (vercel.json). Idempotente — rodar duas vezes no mesmo
 * dia não duplica suspensão nem e-mail (o estado já terá mudado).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function executar(req: Request) {
  const negado = autorizarCron(req);
  if (negado) return negado;

  try {
    const assinaturas = await avaliarAssinaturas();
    const [tokens, janelas] = await Promise.all([limparTokensExpirados(), limparExpirados()]);

    return NextResponse.json({
      ok: true,
      ...assinaturas,
      tokensRemovidos: tokens,
      janelasRemovidas: janelas,
    });
  } catch (e) {
    logErro("job.assinaturas", e);
    const msg = e instanceof Error ? e.message : "Erro ao avaliar assinaturas.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = executar;
export const POST = executar;
