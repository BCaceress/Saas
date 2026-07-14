import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processarWebhookPagamento } from "@/lib/pagamentos";

// ============================================================
// Webhook do Mercado Pago (PIX dinâmico + Point).
// Configurar no painel MP: <domínio>/api/webhooks/mercadopago
// eventos "payment" e "point_integration_wh".
//
// O corpo chega como { type, data: { id } } (às vezes o id vem em
// query string). O tenant é resolvido pelo externalId do Payment —
// e a assinatura x-signature é validada com o secret salvo na
// PaymentProviderConfig do tenant, quando presente.
// ============================================================

// Assinatura MP: x-signature = "ts=<unix>,v1=<hmac>"; manifest
// "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" com HMAC-SHA256.
function assinaturaValida(
  secret: string,
  dataId: string,
  xSignature: string | null,
  xRequestId: string | null
): boolean {
  if (!xSignature) return false;
  const parts = Object.fromEntries(
    xSignature.split(",").map((p) => p.trim().split("=") as [string, string])
  );
  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return false;

  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId ?? ""};ts:${ts};`;
  const esperado = createHmac("sha256", secret).update(manifest).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(esperado, "hex"), Buffer.from(v1, "hex"));
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  let body: { type?: string; data?: { id?: string | number }; resource?: string } = {};
  try {
    body = await req.json();
  } catch {
    // alguns eventos chegam só com query string
  }

  // id da cobrança/intenção: body.data.id, ?data.id= ou ?id=
  const candidatos = [
    body.data?.id != null ? String(body.data.id) : null,
    url.searchParams.get("data.id"),
    url.searchParams.get("id"),
  ].filter((v): v is string => !!v);

  if (candidatos.length === 0) {
    return NextResponse.json({ error: "Evento sem id." }, { status: 400 });
  }

  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");

  for (const externalId of [...new Set(candidatos)]) {
    const r = await processarWebhookPagamento({
      externalId,
      verificarAssinatura: (secret) =>
        assinaturaValida(secret, externalId, xSignature, xRequestId),
    });
    if (r.unauthorized) {
      return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
    }
    if (r.found) {
      return NextResponse.json({ ok: true, status: r.status });
    }
  }

  // 200 mesmo sem achar: evita retry infinito do MP para eventos
  // que não são nossos (ex.: cobranças criadas fora do PDV).
  return NextResponse.json({ ok: true, ignored: true });
}
