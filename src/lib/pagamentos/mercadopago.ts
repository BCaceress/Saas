import "server-only";
import {
  CNPJ_CREDENCIADORA,
  normalizarBandeira,
  SEM_DETALHE,
  type CobrancaPix,
  type DetalheCartao,
  type IntencaoCartao,
  type PagamentoProvider,
  type ResultadoIntencao,
  type StatusCobranca,
  type TerminalInfo,
} from "./types";

// ============================================================
// Adapter Mercado Pago.
// - PIX dinâmico: POST /v1/payments (payment_method_id=pix) → QR + copia-e-cola.
// - Cartão integrado: Point Integration API — o PDV envia o valor à maquininha
//   (payment intent) e acompanha até FINISHED/CANCELED.
// Token privado só no servidor (regra de ouro do CLAUDE.md).
// ============================================================

const API = "https://api.mercadopago.com";

// Token colado do painel pode vir com espaços/quebra de linha ou "Bearer "
// duplicado — normaliza antes de montar o header (evita 401/erro de parse).
function limparToken(token: string): string {
  return token.replace(/\s+/g, "").replace(/^bearer/i, "");
}

async function mp<T>(
  token: string,
  path: string,
  init?: RequestInit & { idempotencyKey?: string }
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${limparToken(token)}`,
      "Content-Type": "application/json",
      ...(init?.idempotencyKey ? { "X-Idempotency-Key": init.idempotencyKey } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (body as { message?: string })?.message ??
      `Mercado Pago respondeu ${res.status}.`;
    throw new Error(`Mercado Pago: ${msg}`);
  }
  return body as T;
}

// status do /v1/payments → status normalizado
function mapPaymentStatus(status: string): StatusCobranca {
  switch (status) {
    case "approved":
      return "CONFIRMADO";
    case "rejected":
      return "RECUSADO";
    case "cancelled":
      return "CANCELADO";
    case "expired":
      return "EXPIRADO";
    case "refunded":
    case "charged_back":
      return "ESTORNADO";
    case "in_process":
    case "in_mediation":
      return "PROCESSANDO";
    default:
      return "PENDENTE"; // pending, authorized…
  }
}

// state da payment intent (Point) → status normalizado
function mapIntentState(state: string): StatusCobranca {
  switch (state) {
    case "FINISHED":
      return "CONFIRMADO";
    case "CANCELED":
    case "ABANDONED":
      return "CANCELADO";
    case "ERROR":
      return "RECUSADO";
    case "OPEN":
      return "PENDENTE";
    default:
      return "PROCESSANDO"; // ON_TERMINAL, PROCESSING…
  }
}

export function mercadoPagoProvider(accessToken: string): PagamentoProvider {
  /** Id da transação por trás de uma payment intent do Point. */
  async function pagamentoDaIntencao(intentId: string): Promise<string | null> {
    const body = await mp<{ payment?: { id?: number | string } }>(
      accessToken,
      `/point/integration-api/payment-intents/${intentId}`
    );
    return body.payment?.id ? String(body.payment.id) : null;
  }

  /**
   * Lê o pagamento aprovado e extrai o que a NFC-e e a conciliação pedem.
   * Best-effort de propósito: falhar aqui não pode derrubar uma venda que o
   * cliente já pagou — sem detalhe a nota sai só com tpIntegra.
   */
  async function detalheDoPagamento(
    pspPaymentId: string | null
  ): Promise<DetalheCartao | null> {
    if (!pspPaymentId) return null;
    try {
      const p = await mp<{
        id: number | string;
        payment_method_id?: string;
        installments?: number;
        authorization_code?: string | null;
        transaction_details?: { acquirer_reference?: string | null };
      }>(accessToken, `/v1/payments/${pspPaymentId}`);
      return {
        // "master", "visa", "elo"… — rótulo do adquirente, não do operador.
        bandeira: normalizarBandeira(p.payment_method_id),
        parcelas: p.installments ?? null,
        nsu: p.transaction_details?.acquirer_reference ?? null,
        autorizacao: p.authorization_code ?? null,
        adquirenteCnpj: CNPJ_CREDENCIADORA.MERCADO_PAGO ?? null,
        pspPaymentId: String(p.id),
      };
    } catch {
      // A credenciadora não depende da consulta — é o próprio PSP.
      return {
        ...SEM_DETALHE,
        adquirenteCnpj: CNPJ_CREDENCIADORA.MERCADO_PAGO ?? null,
        pspPaymentId,
      };
    }
  }

  return {
    slug: "MERCADO_PAGO",
    suportaCartaoIntegrado: true,

    // GET /users/me é leitura pura e exige Access Token válido.
    async validarCredenciais(): Promise<void> {
      await mp(accessToken, "/users/me");
    },

    async criarCobrancaPix(input): Promise<CobrancaPix> {
      const expiraEm = new Date(
        Date.now() + (input.expiraEmSegundos ?? 15 * 60) * 1000
      );
      const body = await mp<{
        id: number;
        point_of_interaction?: {
          transaction_data?: { qr_code?: string; qr_code_base64?: string };
        };
      }>(accessToken, "/v1/payments", {
        method: "POST",
        idempotencyKey: input.idempotencyKey,
        body: JSON.stringify({
          transaction_amount: Number(input.valor.toFixed(2)),
          description: input.descricao,
          payment_method_id: "pix",
          external_reference: input.referencia,
          date_of_expiration: expiraEm.toISOString(),
          payer: { email: input.payerEmail },
        }),
      });

      const td = body.point_of_interaction?.transaction_data;
      if (!td?.qr_code) {
        throw new Error("Mercado Pago não retornou o QR Code da cobrança PIX.");
      }
      return {
        externalId: String(body.id),
        copiaECola: td.qr_code,
        qrCodeBase64: td.qr_code_base64 ?? null,
        expiraEm,
      };
    },

    async consultarCobranca(externalId): Promise<StatusCobranca> {
      const body = await mp<{ status: string }>(
        accessToken,
        `/v1/payments/${externalId}`
      );
      return mapPaymentStatus(body.status);
    },

    async cancelarCobranca(externalId): Promise<void> {
      await mp(accessToken, `/v1/payments/${externalId}`, {
        method: "PUT",
        body: JSON.stringify({ status: "cancelled" }),
      });
    },

    async listarTerminais(): Promise<TerminalInfo[]> {
      const body = await mp<{
        devices?: { id: string; operating_mode?: string }[];
      }>(accessToken, "/point/integration-api/devices?limit=50");
      return (body.devices ?? []).map((d) => ({
        externalId: d.id,
        nome: d.id,
        operatingMode: d.operating_mode ?? null,
      }));
    },

    async prepararTerminal(deviceId): Promise<void> {
      await mp(accessToken, `/point/integration-api/devices/${deviceId}`, {
        method: "PATCH",
        body: JSON.stringify({ operating_mode: "PDV" }),
      });
    },

    async criarIntencaoCartao(input): Promise<IntencaoCartao> {
      // Point usa centavos inteiros; débito não parcela.
      const centavos = Math.round(input.valor * 100);
      const payment =
        input.tipo === "CREDITO"
          ? {
              type: "credit_card",
              installments: Math.max(1, input.parcelas ?? 1),
              installments_cost: "buyer",
            }
          : { type: "debit_card" };
      const body = await mp<{ id: string }>(
        accessToken,
        `/point/integration-api/devices/${input.deviceId}/payment-intents`,
        {
          method: "POST",
          body: JSON.stringify({
            amount: centavos,
            additional_info: {
              external_reference: input.referencia,
              print_on_terminal: true,
            },
            payment,
          }),
        }
      );
      return { externalId: body.id };
    },

    async consultarIntencao(externalId): Promise<ResultadoIntencao> {
      const body = await mp<{ state: string; payment?: { id?: number | string } }>(
        accessToken,
        `/point/integration-api/payment-intents/${externalId}`
      );
      const status = mapIntentState(body.state);
      if (status !== "CONFIRMADO") return { status };

      // A intenção só diz que terminou. Bandeira, parcelas e código de
      // autorização moram no pagamento — uma chamada a mais, uma única vez,
      // na transição para aprovado.
      const pspPaymentId = body.payment?.id ? String(body.payment.id) : null;
      return { status, detalhe: await detalheDoPagamento(pspPaymentId) };
    },

    async estornarCobranca(input): Promise<void> {
      // PIX: o externalId já É o pagamento. Cartão: é a intenção — o id da
      // transação veio na aprovação, e se não veio, relemos a intenção.
      const alvo = input.cartao
        ? (input.pspPaymentId ?? (await pagamentoDaIntencao(input.externalId)))
        : input.externalId;
      if (!alvo) {
        throw new Error(
          "Mercado Pago: transação do cartão não identificada — estorne pelo painel."
        );
      }
      await mp(accessToken, `/v1/payments/${alvo}/refunds`, {
        method: "POST",
        // O MP trata refund sem valor como total; com valor, parcial.
        body: JSON.stringify(input.valor == null ? {} : { amount: Number(input.valor.toFixed(2)) }),
      });
    },

    async cancelarIntencao(deviceId, externalId): Promise<void> {
      await mp(
        accessToken,
        `/point/integration-api/devices/${deviceId}/payment-intents/${externalId}`,
        { method: "DELETE" }
      );
    },
  };
}
