import { NextResponse } from "next/server";
import { autorizarCron } from "@/lib/cron";
import { sincronizarCaixasTodos } from "@/lib/fiscal/email-inbox";

/**
 * Varre as caixas de e-mail monitoradas e importa o XML que os fornecedores
 * mandaram. É o que faz a nota aparecer sozinha na fila de recebimento.
 *
 * Agendamento: a cada 15–30 min (ver `vercel.crons.pro.json`). No plano Hobby
 * ele roda junto do dispatcher `/api/jobs/diario`.
 *
 * Idempotente: Message-ID já processado é pulado e a chave da NF-e é única por
 * tenant — rodar duas vezes não duplica nota nem entrada de estoque.
 * Segurança: exige `Authorization: Bearer <CRON_SECRET>` quando definido.
 */

export const runtime = "nodejs"; // IMAP fala TLS cru — não roda em edge
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function executar(req: Request) {
  const negado = autorizarCron(req);
  if (negado) return negado;

  try {
    const r = await sincronizarCaixasTodos();
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao varrer as caixas de e-mail.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return executar(req);
}

export async function POST(req: Request) {
  return executar(req);
}
