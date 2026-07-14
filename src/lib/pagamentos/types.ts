import type { PaymentProviderKind } from "@/generated/prisma";

// ============================================================
// Payment Service — contrato do provedor de pagamento integrado.
// O PDV nunca fala com um PSP direto: fala com esta interface, e o
// adapter concreto (Mercado Pago, Simulado, …) traduz. Trocar de
// provedor = escrever outro adapter, sem tocar no PDV.
// ============================================================

/** Estado normalizado de uma cobrança/intenção no provedor. */
export type StatusCobranca =
  | "PENDENTE" // criada, aguardando pagamento (PIX na tela)
  | "PROCESSANDO" // no terminal / adquirente processando (cartão)
  | "CONFIRMADO"
  | "RECUSADO"
  | "EXPIRADO"
  | "CANCELADO"
  | "ESTORNADO";

export type CobrancaPix = {
  externalId: string;
  /** Payload EMV — o "PIX copia e cola". */
  copiaECola: string;
  /** Imagem do QR em base64 (png), quando o provedor fornece. */
  qrCodeBase64: string | null;
  expiraEm: Date | null;
};

export type IntencaoCartao = {
  externalId: string;
};

export type TerminalInfo = {
  externalId: string;
  nome: string;
  /** Modo atual no provedor (Mercado Pago Point: precisa estar em "PDV"). */
  operatingMode?: string | null;
};

export interface PagamentoProvider {
  slug: PaymentProviderKind;

  /**
   * Chamada leve, sem efeito colateral, que só passa se o token for válido.
   * Ausente quando o PSP não expõe endpoint de leitura barato (ex.: Stone).
   */
  validarCredenciais?(): Promise<void>;

  // ── PIX dinâmico ──
  criarCobrancaPix(input: {
    /** Valor em reais. */
    valor: number;
    descricao: string;
    /** external_reference no PSP — o payment.id (só rótulo, nunca usado de volta pra lookup). */
    referencia: string;
    /** Chave de idempotência (usamos o paymentId). */
    idempotencyKey: string;
    /** E-mail do pagador exigido por alguns PSPs (placeholder no PDV). */
    payerEmail: string;
    /**
     * CPF/CNPJ do pagador (só dígitos), exigido pelo PagBank (customer.tax_id).
     * PDV é anônimo na maioria das vendas — cai pro CNPJ da empresa quando não
     * há Customer com CPF vinculado à venda. Ignorado por MP/Stone.
     */
    payerDocument?: string;
    expiraEmSegundos?: number;
  }): Promise<CobrancaPix>;
  consultarCobranca(externalId: string): Promise<StatusCobranca>;
  cancelarCobranca(externalId: string): Promise<void>;

  // ── Cartão via terminal integrado (Smart POS) — opcional ──
  suportaCartaoIntegrado: boolean;
  listarTerminais?(): Promise<TerminalInfo[]>;
  /** Prepara o terminal para receber intenções via API (MP: operating_mode PDV). */
  prepararTerminal?(deviceId: string): Promise<void>;
  criarIntencaoCartao?(input: {
    deviceId: string;
    /** Valor em reais (o adapter converte se o PSP usa centavos). */
    valor: number;
    tipo: "CREDITO" | "DEBITO";
    parcelas?: number;
    referencia: string;
  }): Promise<IntencaoCartao>;
  consultarIntencao?(externalId: string): Promise<StatusCobranca>;
  cancelarIntencao?(deviceId: string, externalId: string): Promise<void>;
}
