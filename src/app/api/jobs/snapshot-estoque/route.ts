import { NextResponse } from "next/server";
import { snapshotEstoqueTodos } from "@/lib/snapshot";

/**
 * Job diário de StockSnapshot (PRD Fase 7 §2/§9/§11). Grava a foto de saldo/valor
 * por (produto × site) de cada tenant ativo. Idempotente e reprocessável por dia.
 *
 * Agendamento: chamar 1×/dia (cron do Vercel / agendador externo). Segurança:
 * exige `Authorization: Bearer <CRON_SECRET>` quando CRON_SECRET está definido.
 * Opcional `?data=YYYY-MM-DD` para reprocessar um dia específico.
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

  const url = new URL(req.url);
  const dataParam = url.searchParams.get("data");
  const data = dataParam ? new Date(`${dataParam}T12:00:00`) : new Date();
  if (Number.isNaN(data.getTime())) {
    return NextResponse.json({ error: "Data inválida (use YYYY-MM-DD)." }, { status: 400 });
  }

  try {
    const r = await snapshotEstoqueTodos(data);
    return NextResponse.json({ ok: true, data: data.toISOString().slice(0, 10), ...r });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro no snapshot.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// GET p/ cron do Vercel; POST p/ agendadores que disparam via POST.
export const GET = executar;
export const POST = executar;
