import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processarWebhookPagamento } from "@/lib/pagamentos";

// ============================================================
// Webhook PagSeguro (PagBank — API Pedidos v4).
// Configurar no painel PagBank: <domínio>/api/webhooks/pagseguro?token=<assinatura>
// — o PagBank não assina o corpo da notificação, então a proteção é a
// própria URL secreta (query string), comparada com a assinatura salva
// na PaymentProviderConfig do tenant. A confirmação em si SEMPRE
// reconsulta a API do PSP (sincronizar), então uma chamada forjada não
// aprova venda sozinha.
//
// Payload: { id: "ORD_…", charges: [{ id, status }] } — id do order é o
// externalId gravado em Payment.externalId.
// ============================================================

function tokenValido(secret: string, token: string | null): boolean {
  if (!token) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  let body: { id?: string; charges?: { id?: string }[] } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const candidatos = [body.id, ...(body.charges?.map((c) => c.id) ?? [])].filter(
    (v): v is string => !!v
  );
  if (candidatos.length === 0) {
    return NextResponse.json({ error: "Evento sem id." }, { status: 400 });
  }

  const token = url.searchParams.get("token");
  for (const externalId of candidatos) {
    const r = await processarWebhookPagamento({
      externalId,
      verificarAssinatura: (secret) => tokenValido(secret, token),
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
