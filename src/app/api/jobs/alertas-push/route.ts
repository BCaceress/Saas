import { NextResponse } from "next/server";
import { autorizarCron } from "@/lib/cron";
import { dispararAlertasPush } from "@/lib/alertas/push";

/**
 * Notificações de alerta nos aparelhos inscritos.
 *
 * Roda duas vezes por dia (ver vercel.json). NÃO é de hora em hora de
 * propósito: notificação de ERP que toca demais vira notificação desligada, e
 * o sino continua sendo o canal de tudo — o push é só para o que não pode
 * esperar alguém abrir o sistema.
 *
 * `?agora=1` ignora a janela de horário (7h–21h) para testar fora dela.
 */

export const runtime = "nodejs"; // web-push usa crypto do Node
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function executar(req: Request) {
  const negado = autorizarCron(req);
  if (negado) return negado;

  const ignorarHorario = new URL(req.url).searchParams.get("agora") === "1";

  try {
    const r = await dispararAlertasPush({ ignorarHorario });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro no disparo de push.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = executar;
export const POST = executar;
