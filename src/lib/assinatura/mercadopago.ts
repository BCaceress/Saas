import "server-only";
import type {
  AssinaturaProvider,
  Checkout,
  Cobranca,
  DadosCheckout,
  EstadoAssinatura,
} from "./types";
import type { SubscriptionStatus } from "@/generated/prisma";

// ============================================================
// Adapter Mercado Pago — Preapproval (assinatura recorrente).
//
// Sem plano pré-cadastrado no painel: criamos o preapproval com valor próprio,
// porque o preço final depende de plano + add-ons + lojas extras. Plano fixo no
// MP obrigaria a cadastrar uma combinação para cada venda.
//
// `external_reference` carrega o tenantId — é o que amarra o webhook de volta
// à conta certa sem depender de mapa em memória.
//
// O token aqui é o NOSSO (MP_ASSINATURA_ACCESS_TOKEN), não o do lojista: quem
// recebe esta cobrança é a NoHub. Não confundir com lib/pagamentos, onde o
// token é do lojista e o dinheiro é dele.
// ============================================================

const API = "https://api.mercadopago.com";

function token(): string {
  const t = process.env.MP_ASSINATURA_ACCESS_TOKEN?.trim();
  if (!t) {
    throw new Error(
      "MP_ASSINATURA_ACCESS_TOKEN não configurado — assinatura por Mercado Pago indisponível.",
    );
  }
  return t.replace(/\s+/g, "").replace(/^bearer/i, "");
}

async function mp<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { message?: string })?.message ?? `Mercado Pago respondeu ${res.status}.`;
    throw new Error(`Mercado Pago: ${msg}`);
  }
  return body as T;
}

/**
 * status do preapproval → nosso status.
 *   pending   — criado, lojista ainda não autorizou o pagamento
 *   authorized— em dia
 *   paused    — MP pausou por falha de cobrança (é a inadimplência dele)
 *   cancelled — encerrado
 */
function mapStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "authorized":
      return "ATIVA";
    case "paused":
      return "INADIMPLENTE";
    case "cancelled":
      return "CANCELADA";
    default:
      return "PENDENTE";
  }
}

type PreapprovalResp = {
  id: string;
  init_point?: string;
  sandbox_init_point?: string;
  status: string;
  next_payment_date?: string;
  auto_recurring?: { transaction_amount?: number };
};

type AuthorizedPaymentResp = {
  id: number | string;
  preapproval_id: string;
  status: string; // processed | recycling | scheduled | cancelled
  transaction_amount?: number;
  debit_date?: string;
  payment?: { id?: number; status?: string; status_detail?: string };
};

export function mercadoPagoAssinatura(): AssinaturaProvider {
  return {
    nome: "mercadopago",

    async criarCheckout(dados: DadosCheckout): Promise<Checkout> {
      const r = await mp<PreapprovalResp>("/preapproval", {
        method: "POST",
        body: JSON.stringify({
          reason: dados.descricao,
          external_reference: dados.tenantId,
          payer_email: dados.emailPagador,
          back_url: dados.urlRetorno,
          status: "pending",
          auto_recurring: {
            frequency: 1,
            frequency_type: "months",
            transaction_amount: Number(dados.valorMensal.toFixed(2)),
            currency_id: "BRL",
          },
        }),
      });

      const url = r.init_point ?? r.sandbox_init_point;
      if (!url) throw new Error("Mercado Pago não devolveu a URL de checkout.");
      return { externalId: r.id, checkoutUrl: url };
    },

    async consultar(externalId: string): Promise<EstadoAssinatura> {
      const r = await mp<PreapprovalResp>(`/preapproval/${externalId}`);
      return {
        status: mapStatus(r.status),
        proximaCobranca: r.next_payment_date ? new Date(r.next_payment_date) : null,
        valorMensal: r.auto_recurring?.transaction_amount ?? null,
      };
    },

    async cancelar(externalId: string): Promise<void> {
      await mp(`/preapproval/${externalId}`, {
        method: "PUT",
        body: JSON.stringify({ status: "cancelled" }),
      });
    },

    async consultarCobranca(idCobranca: string): Promise<Cobranca | null> {
      const r = await mp<AuthorizedPaymentResp>(`/authorized_payments/${idCobranca}`);
      if (!r?.preapproval_id) return null;

      // "processed" com pagamento aprovado é a única combinação que quita o
      // mês. "recycling" é o MP tentando de novo — ainda não entrou dinheiro.
      const aprovada = r.status === "processed" && (r.payment?.status ?? "") === "approved";

      return {
        externalIdAssinatura: r.preapproval_id,
        aprovada,
        valor: r.transaction_amount ?? null,
        data: r.debit_date ? new Date(r.debit_date) : null,
        detalhe: r.payment?.status_detail ?? r.status,
      };
    },
  };
}
