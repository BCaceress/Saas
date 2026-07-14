import "server-only";
import type { PaymentAmbiente } from "@/generated/prisma";
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

const API_PRODUCAO = "https://api.pagseguro.com";
const API_SANDBOX = "https://sandbox.api.pagseguro.com";

function apiHost(ambiente: PaymentAmbiente): string {
  return ambiente === "SANDBOX" ? API_SANDBOX : API_PRODUCAO;
}

// Token colado do painel às vezes vem com "Bearer " na frente ou quebra de
// linha/espaços (quebra de texto no copiar-colar) — isso vira um header
// Authorization inválido ("Bearer Bearer xxx…"), rejeitado pelo gateway do
// PagBank com um erro de parse genérico. Normaliza antes de montar o header.
function limparToken(token: string): string {
  return token.replace(/\s+/g, "").replace(/^bearer/i, "");
}

async function pagseguro<T>(
  api: string,
  token: string,
  path: string,
  init?: RequestInit & { idempotencyKey?: string }
): Promise<T> {
  const res = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${limparToken(token)}`,
      "Content-Type": "application/json",
      ...(init?.idempotencyKey ? { "x-idempotency-key": init.idempotencyKey } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = body as {
      error_messages?: { description?: string; parameter_name?: string }[];
      message?: string;
    };
    const detalhe =
      b?.error_messages
        ?.map((m) => (m.parameter_name ? `${m.parameter_name}: ${m.description}` : m.description))
        .filter(Boolean)
        .join("; ") ??
      b?.message ??
      `respondeu ${res.status}`;
    // Conta ainda não liberada pelo PagBank para a API de Pedidos/Pix — não é
    // erro de token nem de código, é liberação pendente no lado do provedor.
    if (/whitelist/i.test(detalhe)) {
      throw new Error(
        "Conta PagBank sem liberação para gerar Pix pela API. Contate o suporte PagBank e " +
          "peça a liberação (whitelist) da API de Pedidos para esta conta."
      );
    }
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

export function pagseguroProvider(
  accessToken: string,
  ambiente: PaymentAmbiente = "PRODUCAO"
): PagamentoProvider {
  const api = apiHost(ambiente);

  return {
    slug: "PAGSEGURO",
    suportaCartaoIntegrado: false,

    // Reaproveita a mesma rota (/orders/:id) do consultarCobranca com um id
    // que não existe: 404 confirma que o Bearer passou pela autenticação
    // (só não achou o pedido); 401/403 é credencial inválida. Sem side
    // effect — não cria nada. (Evitamos /public-keys: no gateway do
    // PagBank ela responde com um erro de parse de header genérico, não
    // relacionado ao token em si.)
    async validarCredenciais(): Promise<void> {
      const res = await fetch(`${api}/orders/00000000-0000-0000-0000-000000000000`, {
        headers: { Authorization: `Bearer ${limparToken(accessToken)}` },
        cache: "no-store",
      });
      if (res.status === 401 || res.status === 403) {
        throw new Error("Token inválido ou sem permissão para acessar a conta PagBank.");
      }
    },

    async criarCobrancaPix(input): Promise<CobrancaPix> {
      if (!input.payerDocument) {
        throw new Error(
          "CNPJ da empresa não cadastrado — preencha em Configurações → Empresa para gerar Pix pelo PagBank."
        );
      }
      const expiresIn = input.expiraEmSegundos ?? 15 * 60;
      const expirationDate = new Date(Date.now() + expiresIn * 1000);
      const body = await pagseguro<PagbankOrder>(api, accessToken, "/orders", {
        method: "POST",
        idempotencyKey: input.idempotencyKey,
        body: JSON.stringify({
          reference_id: input.referencia,
          customer: {
            name: "Cliente PDV",
            email: input.payerEmail,
            tax_id: input.payerDocument,
          },
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
      const body = await pagseguro<PagbankOrder>(api, accessToken, `/orders/${externalId}`);
      const charge = body.charges?.[0];
      if (!charge) return "PENDENTE";
      return mapChargeStatus(charge.status);
    },

    async cancelarCobranca(externalId): Promise<void> {
      const body = await pagseguro<PagbankOrder>(api, accessToken, `/orders/${externalId}`);
      const qr = body.qr_codes?.[0];
      if (!qr) return;
      await pagseguro(api, accessToken, `/orders/${externalId}/qr_codes/${qr.id}`, {
        method: "DELETE",
      });
    },
  };
}
