import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { mercadoPagoAssinatura } from "@/lib/assinatura/mercadopago";
import {
  registrarCobranca,
  registrarEventoAssinatura,
  sincronizarAssinatura,
  tenantPorExternalId,
} from "@/lib/assinatura";
import { logErro, logInfo } from "@/lib/log";

// ============================================================
// Webhook da ASSINATURA DO SAAS (o que o lojista paga a nós).
//
// Não confundir com /api/webhooks/mercadopago, que trata a venda do lojista ao
// consumidor. São contas Mercado Pago diferentes: aqui o token é o nosso.
//
// Painel MP (nossa conta) → Webhooks → <domínio>/api/webhooks/assinatura
// Eventos: "subscription_preapproval" e "subscription_authorized_payment".
//
// Sempre devolve 200 para evento que não é nosso: 4xx faz o MP reenfileirar
// para sempre um evento que nunca vai reconhecer.
// ============================================================

export const dynamic = "force-dynamic";

/** x-signature = "ts=<unix>,v1=<hmac>" sobre "id:<id>;request-id:<rid>;ts:<ts>;". */
function assinaturaValida(dataId: string, xSignature: string | null, xRequestId: string | null) {
  const secret = process.env.MP_ASSINATURA_WEBHOOK_SECRET?.trim();

  // Sem segredo configurado a rota fica FECHADA em produção. Aceitar tudo aqui
  // permitiria a qualquer um postar "pagamento aprovado" e liberar acesso.
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!xSignature) return false;

  const partes = Object.fromEntries(
    xSignature.split(",").map((p) => p.trim().split("=") as [string, string]),
  );
  const ts = partes["ts"];
  const v1 = partes["v1"];
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
  let body: { type?: string; action?: string; data?: { id?: string | number } } = {};
  try {
    body = await req.json();
  } catch {
    // eventos antigos chegam só com query string
  }

  const tipo = body.type ?? url.searchParams.get("type") ?? url.searchParams.get("topic") ?? "";
  const id =
    (body.data?.id != null ? String(body.data.id) : null) ??
    url.searchParams.get("data.id") ??
    url.searchParams.get("id");

  if (!id) return NextResponse.json({ error: "Evento sem id." }, { status: 400 });

  if (!assinaturaValida(id, req.headers.get("x-signature"), req.headers.get("x-request-id"))) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  try {
    // Cobrança do ciclo: aprovada quita o mês, recusada abre a tolerância.
    if (tipo.includes("authorized_payment")) {
      const provider = mercadoPagoAssinatura();
      const cobranca = await provider.consultarCobranca?.(id);
      if (!cobranca) return NextResponse.json({ ok: true, ignored: true });
      await registrarCobranca(cobranca);
      logInfo("assinatura.webhook", { tipo, aprovada: cobranca.aprovada });
      return NextResponse.json({ ok: true });
    }

    // Mudança de estado do preapproval (autorizado, pausado, cancelado).
    if (tipo.includes("preapproval")) {
      const tenantId = await tenantPorExternalId(id);
      if (!tenantId) return NextResponse.json({ ok: true, ignored: true });

      await registrarEventoAssinatura({ externalId: id, tipo: body.action ?? tipo });
      const status = await sincronizarAssinatura(tenantId);
      logInfo("assinatura.webhook", { tipo, tenantId, status });
      return NextResponse.json({ ok: true, status });
    }
  } catch (e) {
    logErro("assinatura.webhook", e, { tipo, id });
    // 500 faz o MP tentar de novo — é o que queremos quando a falha é nossa.
    return NextResponse.json({ error: "Falha ao processar evento." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ignored: true });
}
