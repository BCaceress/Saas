import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processarWebhookPagamento } from "@/lib/pagamentos";

// ============================================================
// Webhook Stone (API Pagar.me v5).
// Configurar no dash Pagar.me: <domínio>/api/webhooks/stone,
// eventos charge.paid / charge.payment_failed / charge.canceled.
//
// Payload: { type: "charge.paid", data: { id: "ch_…", … } } —
// data.id é o charge id gravado em Payment.externalId.
//
// Autenticação: o dash permite proteger o webhook com Basic Auth;
// salve "usuario:senha" no campo de assinatura da config e o header
// Authorization é validado. A confirmação em si SEMPRE reconsulta a
// API do PSP (sincronizar), então webhook forjado não aprova venda.
// ============================================================

function basicAuthValida(secret: string, authorization: string | null): boolean {
  if (!authorization) return false;
  const esperado = `Basic ${Buffer.from(secret).toString("base64")}`;
  const a = Buffer.from(esperado);
  const b = Buffer.from(authorization);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  let body: { type?: string; data?: { id?: string; order?: { id?: string } } } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  // PIX guarda o charge (ch_…) como externalId; cartão no POS guarda a
  // ORDER (or_…) — o evento charge.paid traz os dois, tenta ambos.
  const candidatos = [body.data?.id, body.data?.order?.id].filter(
    (v): v is string => !!v
  );
  if (candidatos.length === 0) {
    return NextResponse.json({ error: "Evento sem id." }, { status: 400 });
  }

  const authorization = req.headers.get("authorization");
  for (const externalId of candidatos) {
    const r = await processarWebhookPagamento({
      externalId,
      verificarAssinatura: (secret) => basicAuthValida(secret, authorization),
    });
    if (r.unauthorized) {
      return NextResponse.json({ error: "Autenticação inválida." }, { status: 401 });
    }
    if (r.found) {
      return NextResponse.json({ ok: true, status: r.status });
    }
  }
  // 200 para eventos que não são nossos — evita retry infinito
  return NextResponse.json({ ok: true, ignored: true });
}
