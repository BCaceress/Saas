import { NextResponse } from "next/server";
import { confirmarPagamentoVenda } from "@/lib/vendas";

// Confirmação de pagamento self-service (PRD Fase 4 §6/§12). Idempotente.
// O gateway é configurado com referência = "<tenantId>:<saleId>" (ou os campos
// no corpo), já que o webhook chega sem subdomínio para resolver o tenant.
//
// Segurança: valida um segredo compartilhado quando PIX_WEBHOOK_SECRET existe.
export async function POST(req: Request) {
  const secret = process.env.PIX_WEBHOOK_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const token = req.headers.get("x-webhook-secret") ?? url.searchParams.get("token");
    if (token !== secret) {
      return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    }
  }

  let body: { tenantId?: string; saleId?: string; referencia?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  let { tenantId, saleId } = body;
  if (!tenantId && !saleId && body.referencia?.includes(":")) {
    [tenantId, saleId] = body.referencia.split(":");
  }
  if (!tenantId || !saleId) {
    return NextResponse.json({ error: "Informe tenantId e saleId (ou referencia)." }, { status: 400 });
  }

  // status diferente de pago/confirmado: ignora (ex.: pendente/expirado)
  const status = (body.status ?? "CONFIRMADO").toUpperCase();
  if (status !== "CONFIRMADO" && status !== "PAGO" && status !== "PAID") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const r = await confirmarPagamentoVenda(tenantId, saleId);
    return NextResponse.json({ ok: true, already: r.already });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao confirmar.";
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
