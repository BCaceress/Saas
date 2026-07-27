import type { SubscriptionStatus } from "@/generated/prisma";

// ============================================================
// Contrato do gateway de assinatura (o que o LOJISTA paga a nós).
//
// Mesmo desenho de lib/pagamentos: o adapter fala o dialeto do gateway, o
// orquestrador só conhece este contrato. Trocar de gateway não deve encostar
// em nenhuma tela.
// ============================================================

export type DadosCheckout = {
  tenantId: string;
  /** Aparece na fatura do cartão do lojista. */
  descricao: string;
  valorMensal: number;
  emailPagador: string;
  /** Para onde o gateway devolve o lojista depois de autorizar. */
  urlRetorno: string;
};

export type Checkout = {
  externalId: string;
  checkoutUrl: string;
};

export type EstadoAssinatura = {
  status: SubscriptionStatus;
  proximaCobranca: Date | null;
  valorMensal: number | null;
};

/** Uma cobrança específica do ciclo — o que o webhook de pagamento traz. */
export type Cobranca = {
  externalIdAssinatura: string;
  aprovada: boolean;
  valor: number | null;
  data: Date | null;
  detalhe?: string;
};

export type AssinaturaProvider = {
  nome: string;
  criarCheckout(dados: DadosCheckout): Promise<Checkout>;
  consultar(externalId: string): Promise<EstadoAssinatura>;
  cancelar(externalId: string): Promise<void>;
  /** Consulta uma cobrança pelo id recebido no webhook. */
  consultarCobranca?(idCobranca: string): Promise<Cobranca | null>;
};
