import "server-only";
import type { CobrancaPix, PagamentoProvider, StatusCobranca } from "./types";

// ============================================================
// Adapter PagSeguro (PagBank) — API Pedidos v4.
//
// PIX dinâmico: POST /orders com qr_codes[]; o externalId é o QR CODE
// (retornado em qr_codes[0].id). Consulta reconsulta o ORDER e olha o
// charge mais recente (paid/declined/canceled).
//
// Cartão integrado: sem suporte — o PagBank não expõe API pública de
// maquininha (Moderninha) para intenção remota; permanece maquininha
// externa/manual, igual ao cartão da Stone antes do Connect.
// ============================================================

const API = "https://api.pagseguro.com";

async function pagseguro<T>(
  token: string,
  path: string,
  init?: RequestInit & { idempotencyKey?: string }
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.idempotencyKey ? { "x-idempotency-key": init.idempotencyKey } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = body as { error_messages?: { description?: string }[]; message?: string };
    const detalhe =
      b?.error_messages?.map((m) => m.description).filter(Boolean).join("; ") ??
      b?.message ??
      `respondeu ${res.status}`;
    throw new Error(`PagSeguro: ${detalhe}`);
  }
  return body as T;
}

// status do charge PagBank → status normalizado
function mapChargeStatus(status: string): StatusCobranca {
  switch (status) {
    case "PAID":
      return "CONFIRMADO";
    case "DECLINED":
      return "RECUSADO";
    case "CANCELED":
      return "CANCELADO";
    case "IN_ANALYSIS":
    case "AUTHORIZED":
      return "PROCESSANDO";
    default:
      return "PENDENTE"; // WAITING…
  }
}

type PagbankOrder = {
  id: string;
  qr_codes?: { id: string; text: string; amount?: { value: number }; expiration_date?: string }[];
  charges?: { status: string }[];
};

export function pagseguroProvider(accessToken: string): PagamentoProvider {
  return {
    slug: "PAGSEGURO",
    suportaCartaoIntegrado: false,

    async criarCobrancaPix(input): Promise<CobrancaPix> {
      const expiresIn = input.expiraEmSegundos ?? 15 * 60;
      const expirationDate = new Date(Date.now() + expiresIn * 1000);
      const body = await pagseguro<PagbankOrder>(accessToken, "/orders", {
        method: "POST",
        idempotencyKey: input.idempotencyKey,
        body: JSON.stringify({
          reference_id: input.referencia,
          customer: { name: "Cliente PDV", email: input.payerEmail },
          items: [
            {
              name: input.descricao,
              quantity: 1,
              unit_amount: Math.round(input.valor * 100), // centavos
            },
          ],
          qr_codes: [
            {
              amount: { value: Math.round(input.valor * 100) },
              expiration_date: expirationDate.toISOString(),
            },
          ],
        }),
      });

      const qr = body.qr_codes?.[0];
      if (!qr?.text) {
        throw new Error("PagSeguro não retornou o QR Code da cobrança PIX.");
      }
      return {
        // guardamos o ORDER (não o qr_code) — é o id que a API usa para consulta/cancelamento
        externalId: body.id,
        copiaECola: qr.text,
        // PagBank não devolve base64 — o app gera o QR no cliente a partir do copia-e-cola (PixQr)
        qrCodeBase64: null,
        expiraEm: qr.expiration_date ? new Date(qr.expiration_date) : expirationDate,
      };
    },

    async consultarCobranca(externalId): Promise<StatusCobranca> {
      const body = await pagseguro<PagbankOrder>(accessToken, `/orders/${externalId}`);
      const charge = body.charges?.[0];
      if (!charge) return "PENDENTE";
      return mapChargeStatus(charge.status);
    },

    async cancelarCobranca(externalId): Promise<void> {
      const body = await pagseguro<PagbankOrder>(accessToken, `/orders/${externalId}`);
      const qr = body.qr_codes?.[0];
      if (!qr) return;
      await pagseguro(accessToken, `/orders/${externalId}/qr_codes/${qr.id}`, {
        method: "DELETE",
      });
    },
  };
}
