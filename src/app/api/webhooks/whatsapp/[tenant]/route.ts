import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  configDoTenant,
  registrarStatus,
  statusDaMeta,
  verificacaoConfere,
} from "@/lib/whatsapp";

// ============================================================
// Webhook do WhatsApp Cloud API (Meta) — um endereço por tenant:
//   <domínio>/api/webhooks/whatsapp/<id do tenant>, campo "messages".
//
// O tenant está na URL porque cada cliente configura o SEU app na Meta: o
// handshake de verificação acontece antes de existir qualquer mensagem que
// pudesse identificar alguém, e um token global seria o mesmo segredo na mão
// de todos. O id do tenant não é segredo — quem protege é o token derivado
// dele (ver `tokenDeVerificacao`) e a assinatura do App Secret.
//
// Só entram STATUS de mensagem que saiu daqui. Mensagem que o fornecedor
// escreve de volta não é tratada: a resposta da cotação é pelo link.
// ============================================================

/** Handshake: a Meta chama uma vez, com o token que está no painel dela. */
export async function GET(req: Request, ctx: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await ctx.params;
  const url = new URL(req.url);
  const modo = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");

  if (modo !== "subscribe" || !verificacaoConfere(tenant, token)) {
    return new NextResponse("forbidden", { status: 403 });
  }
  return new NextResponse(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
}

/** `X-Hub-Signature-256: sha256=<hmac do corpo cru com o App Secret>`. */
function assinaturaValida(appSecret: string, corpoCru: string, cabecalho: string | null): boolean {
  if (!cabecalho?.startsWith("sha256=")) return false;
  const esperado = createHmac("sha256", appSecret).update(corpoCru, "utf8").digest("hex");
  try {
    return timingSafeEqual(
      Buffer.from(esperado, "hex"),
      Buffer.from(cabecalho.slice("sha256=".length), "hex"),
    );
  } catch {
    return false;
  }
}

type Evento = {
  entry?: {
    changes?: {
      value?: {
        metadata?: { phone_number_id?: string };
        statuses?: {
          id?: string;
          status?: string;
          timestamp?: string;
          errors?: { title?: string; message?: string; error_data?: { details?: string } }[];
        }[];
      };
    }[];
  }[];
};

export async function POST(req: Request, ctx: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await ctx.params;
  const cfg = await configDoTenant(tenant);
  if (!cfg) return NextResponse.json({ ok: true });

  // Corpo CRU: a assinatura é sobre os bytes que chegaram, e `JSON.parse` +
  // `stringify` mudaria espaçamento e ordem, quebrando o HMAC.
  const cru = await req.text();

  // Com App Secret configurado, assinatura é obrigatória. Sem ele, o endpoint
  // aceita — é o estado de quem ainda está montando a integração, e a tela diz
  // que falta.
  if (cfg.appSecret && !assinaturaValida(cfg.appSecret, cru, req.headers.get("x-hub-signature-256"))) {
    return new NextResponse("invalid signature", { status: 401 });
  }

  let evento: Evento;
  try {
    evento = JSON.parse(cru) as Evento;
  } catch {
    return NextResponse.json({ ok: true });
  }

  for (const entry of evento.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const valor = change.value;
      // O número tem de ser o configurado neste tenant: assim um evento
      // postado no endereço errado não vira status na trilha de outro.
      if (valor?.metadata?.phone_number_id !== cfg.phoneNumberId) continue;

      for (const s of valor?.statuses ?? []) {
        const status = s.status ? statusDaMeta(s.status) : null;
        if (!status || !s.id) continue;
        const erro = s.errors?.[0];
        await registrarStatus({
          tenantId: cfg.tenantId,
          externalId: s.id,
          status,
          erro: erro ? (erro.error_data?.details ?? erro.message ?? erro.title ?? null) : null,
          em: s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date(),
        });
      }
    }
  }

  // Sempre 200 depois de processar: a Meta repete o que não recebe confirmação
  // e desativa o webhook que falha demais.
  return NextResponse.json({ ok: true });
}
