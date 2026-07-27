import "server-only";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { logAviso } from "./log";

// ============================================================
// Autorização dos jobs agendados.
//
// FALHA FECHADA: sem `CRON_SECRET` em produção a rota devolve 503 em vez de
// rodar aberta. Um /api/jobs público deixa qualquer um disparar snapshot,
// reprocessar fila fiscal e varrer assinaturas de todos os tenants — o custo
// de esquecer a variável não pode ser esse.
//
// Em desenvolvimento o job roda sem segredo, senão testar vira burocracia.
// ============================================================

function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** `null` = autorizado. Caso contrário, devolva a resposta retornada. */
export function autorizarCron(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      logAviso("cron.sem-segredo", "CRON_SECRET ausente — job recusado.");
      return NextResponse.json(
        { error: "Job desabilitado: CRON_SECRET não configurado." },
        { status: 503 },
      );
    }
    return null;
  }

  const header = req.headers.get("authorization") ?? "";
  if (!iguais(header, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  return null;
}
