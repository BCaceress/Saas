import { NextResponse } from "next/server";
import { processarFilaFiscalTodos } from "@/lib/fiscal/emissao";

/**
 * Rede de segurança da fila de emissão. O caminho normal é o polling da tela do
 * PDV empurrar a própria nota; este job pega o que ficou para trás — caixa
 * fechado no meio do processo, SEFAZ que voltou de madrugada, contingência.
 *
 * Agendamento: a cada 5–15 min. Idempotente: documento já autorizado é ignorado.
 * Segurança: exige `Authorization: Bearer <CRON_SECRET>` quando definido.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function executar(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    }
  }

  try {
    const r = await processarFilaFiscalTodos();
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao processar a fila fiscal.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return executar(req);
}

export async function POST(req: Request) {
  return executar(req);
}
