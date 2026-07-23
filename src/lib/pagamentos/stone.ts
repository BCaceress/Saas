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
// Adapter Stone — API Pagar.me v5 (grupo Stone).
//
// PIX dinâmico: Order fechada com payment_method=pix; o externalId é o
// CHARGE (ch_…).
//
// Cartão integrado: Stone Connect 2.0 — "pedido direto": Order ABERTA
// (closed=false) com poi_payment_settings apontando o SERIAL da
// maquininha; o POS entra sozinho na tela de pagamento. Exige o código
// do Programa de Parcerias Stone no header ServiceRefererName e não há
// API para listar terminais (o serial é cadastrado à mão). O externalId
// é a ORDER (or_…) — o webhook charge.paid traz o charge e a order.
// ============================================================

const API = "https://api.pagar.me/core/v5";

// Chave colada do painel pode vir com espaços/quebra de linha — normaliza
// antes de montar o header (evita 401/erro de parse no Basic auth).
function limparToken(token: string): string {
  return token.replace(/\s+/g, "");
}

async function pagarme<T>(
  secretKey: string,
  path: string,
  init?: RequestInit & { idempotencyKey?: string; partnerRef?: string | null }
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      // Basic auth: secret key como usuário, senha vazia
      Authorization: `Basic ${Buffer.from(`${limparToken(secretKey)}:`).toString("base64")}`,
      "Content-Type": "application/json",
      ...(init?.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
      // Stone Connect (POS): identifica o parceiro para rotear ao terminal
      ...(init?.partnerRef ? { ServiceRefererName: init.partnerRef } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = body as { message?: string; errors?: Record<string, string[]> };
    const detalhe =
      b?.message ??
      (b?.errors ? Object.values(b.errors).flat().join("; ") : null) ??
      `respondeu ${res.status}`;
    throw new Error(`Stone/Pagar.me: ${detalhe}`);
  }
  return body as T;
}

// status de charge do Pagar.me → status normalizado
function mapChargeStatus(status: string): StatusCobranca {
  switch (status) {
    case "paid":
      return "CONFIRMADO";
    case "failed":
      return "RECUSADO";
    case "canceled":
      return "CANCELADO";
    case "overpaid":
    case "underpaid":
      return "CONFIRMADO"; // valor divergente ainda é pagamento recebido
    case "refunded":
    case "chargedback":
      return "ESTORNADO";
    case "processing":
      return "PROCESSANDO";
    default:
      return "PENDENTE"; // pending, generated…
  }
}

// status de ORDER (cartão no POS) → status normalizado
function mapOrderStatus(status: string): StatusCobranca {
  switch (status) {
    case "paid":
      return "CONFIRMADO";
    case "failed":
      return "RECUSADO";
    case "canceled":
      return "CANCELADO";
    default:
      return "PROCESSANDO"; // pending = aguardando o cliente na maquininha
  }
}

type PagarmeCharge = {
  id: string;
  status: string;
  last_transaction?: {
    // PIX
    qr_code?: string;
    qr_code_url?: string;
    expires_at?: string;
    // Cartão — o que o adquirente devolve na aprovação
    acquirer_auth_code?: string | null;
    acquirer_nsu?: string | null;
    installments?: number | null;
    card?: { brand?: string | null } | null;
  };
};

/** Cartão aprovado no POS → o que a NFC-e e a conciliação precisam. */
function detalheDaCharge(charge: PagarmeCharge | undefined): DetalheCartao {
  const tx = charge?.last_transaction;
  return {
    ...SEM_DETALHE,
    bandeira: normalizarBandeira(tx?.card?.brand),
    parcelas: tx?.installments ?? null,
    nsu: tx?.acquirer_nsu ?? null,
    autorizacao: tx?.acquirer_auth_code ?? null,
    adquirenteCnpj: CNPJ_CREDENCIADORA.STONE ?? null,
    pspPaymentId: charge?.id ?? null,
  };
}

export function stoneProvider(
  secretKey: string,
  partnerRef?: string | null
): PagamentoProvider {
  return {
    slug: "STONE",
    // cartão no POS exige o código de parceiro (ServiceRefererName)
    suportaCartaoIntegrado: !!partnerRef,

    async criarCobrancaPix(input): Promise<CobrancaPix> {
      const expiresIn = input.expiraEmSegundos ?? 15 * 60;
      const body = await pagarme<{ id: string; charges?: PagarmeCharge[] }>(
        secretKey,
        "/orders",
        {
          method: "POST",
          idempotencyKey: input.idempotencyKey,
          body: JSON.stringify({
            code: input.referencia,
            items: [
              {
                amount: Math.round(input.valor * 100), // centavos
                description: input.descricao,
                quantity: 1,
              },
            ],
            customer: { name: "Cliente PDV", email: input.payerEmail },
            payments: [{ payment_method: "pix", pix: { expires_in: expiresIn } }],
          }),
        }
      );

      const charge = body.charges?.[0];
      const tx = charge?.last_transaction;
      if (!charge || !tx?.qr_code) {
        throw new Error("Stone/Pagar.me não retornou o QR Code da cobrança PIX.");
      }
      return {
        externalId: charge.id,
        copiaECola: tx.qr_code,
        // Pagar.me devolve URL de imagem (não base64) — o app gera o QR
        // no cliente a partir do copia-e-cola (PixQr).
        qrCodeBase64: null,
        expiraEm: tx.expires_at
          ? new Date(tx.expires_at)
          : new Date(Date.now() + expiresIn * 1000),
      };
    },

    async consultarCobranca(externalId): Promise<StatusCobranca> {
      const body = await pagarme<{ status: string }>(
        secretKey,
        `/charges/${externalId}`
      );
      return mapChargeStatus(body.status);
    },

    async cancelarCobranca(externalId): Promise<void> {
      await pagarme(secretKey, `/charges/${externalId}`, { method: "DELETE" });
    },

    // ── Cartão integrado (Stone Connect — pedido direto no POS) ──

    async listarTerminais(): Promise<TerminalInfo[]> {
      // Stone não expõe listagem de POS — o serial é cadastrado manualmente.
      return [];
    },

    async criarIntencaoCartao(input): Promise<IntencaoCartao> {
      if (!partnerRef) {
        throw new Error(
          "Cartão integrado Stone exige o código do Programa de Parcerias (ServiceRefererName)."
        );
      }
      const body = await pagarme<{ id: string }>(secretKey, "/orders", {
        method: "POST",
        partnerRef,
        body: JSON.stringify({
          code: input.referencia,
          closed: false, // pedido ABERTO — obrigatório para chegar ao POS
          items: [
            {
              amount: Math.round(input.valor * 100), // centavos
              description: "Venda PDV",
              quantity: 1,
            },
          ],
          customer: { name: "Cliente PDV", email: "cliente@nohub.market" },
          poi_payment_settings: {
            visible: true,
            devices_serial_number: [input.deviceId], // serial da maquininha
            payment_setup: {
              type: input.tipo === "CREDITO" ? "credit" : "debit",
              ...(input.tipo === "CREDITO"
                ? { installments: Math.max(1, input.parcelas ?? 1) }
                : {}),
            },
          },
        }),
      });
      return { externalId: body.id }; // or_…
    },

    async consultarIntencao(externalId): Promise<ResultadoIntencao> {
      const body = await pagarme<{ status: string; charges?: PagarmeCharge[] }>(
        secretKey,
        `/orders/${externalId}`,
        { partnerRef }
      );
      const status = mapOrderStatus(body.status);
      if (status !== "CONFIRMADO") return { status };
      // O pedido do POS gera uma charge por tentativa — a paga é a que vale.
      const paga = body.charges?.find((c) => c.status === "paid") ?? body.charges?.[0];
      return { status, detalhe: detalheDaCharge(paga) };
    },

    async estornarCobranca(input): Promise<void> {
      // PIX: o externalId é a própria charge. Cartão: é o pedido — a charge
      // paga sai dele (ou já veio gravada na aprovação).
      let chargeId = input.pspPaymentId ?? null;
      if (!chargeId) {
        if (!input.cartao) {
          chargeId = input.externalId;
        } else {
          const order = await pagarme<{ charges?: PagarmeCharge[] }>(
            secretKey,
            `/orders/${input.externalId}`,
            { partnerRef }
          );
          chargeId =
            (order.charges?.find((c) => c.status === "paid") ?? order.charges?.[0])?.id ?? null;
        }
      }
      if (!chargeId) {
        throw new Error(
          "Stone/Pagar.me: cobrança não identificada no pedido — estorne pelo painel."
        );
      }
      // No Pagar.me o DELETE da charge é o estorno (total sem body, parcial com amount).
      await pagarme(secretKey, `/charges/${chargeId}`, {
        method: "DELETE",
        ...(input.valor == null
          ? {}
          : { body: JSON.stringify({ amount: Math.round(input.valor * 100) }) }),
      });
    },

    async cancelarIntencao(_deviceId, externalId): Promise<void> {
      // fecha o pedido aberto — some do POS (best-effort no serviço)
      await pagarme(secretKey, `/orders/${externalId}/closed`, {
        method: "PATCH",
        partnerRef,
        body: JSON.stringify({ status: "canceled" }),
      });
    },
  };
}
