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

/**
 * O que o adquirente devolve quando o cartão é aprovado. NUNCA vem do operador:
 * bandeira digitada no caixa é palpite, atrasa a fila e não vale perante a
 * SEFAZ. Daqui saem o grupo `card` da NFC-e (tBand/cAut/CNPJ) e a conciliação.
 * Todo campo é opcional — PSP que não expõe manda null, e a nota simplesmente
 * omite a tag (o grupo `card` só exige tpIntegra).
 */
export type DetalheCartao = {
  /** Normalizada: VISA, MASTERCARD, ELO, AMEX, HIPERCARD, … (ver BANDEIRAS). */
  bandeira: string | null;
  parcelas: number | null;
  nsu: string | null;
  /** authorization_code → cAut da NFC-e. */
  autorizacao: string | null;
  /** CNPJ da credenciadora → card.CNPJ da NFC-e. */
  adquirenteCnpj: string | null;
  /**
   * Id da TRANSAÇÃO no PSP. Diferente do externalId da intenção — é este que o
   * estorno e o extrato usam.
   */
  pspPaymentId: string | null;
};

/** Base para preencher só o que o PSP contou, sem esquecer campo nenhum. */
export const SEM_DETALHE: Readonly<DetalheCartao> = Object.freeze({
  bandeira: null,
  parcelas: null,
  nsu: null,
  autorizacao: null,
  adquirenteCnpj: null,
  pspPaymentId: null,
});

/**
 * Status + o que o adquirente contou junto. O detalhe só existe quando o
 * pagamento chega a um estado final aprovado.
 */
export type ResultadoIntencao = {
  status: StatusCobranca;
  detalhe?: DetalheCartao | null;
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

  /**
   * Devolve o dinheiro de uma cobrança JÁ CONFIRMADA (cancelar só serve antes
   * da aprovação). Ausente quando o PSP não expõe estorno pela API — aí o
   * cancelamento da venda avisa o operador para estornar no painel, em vez de
   * marcar ESTORNADO no banco e deixar o cliente cobrado.
   *
   * O adapter resolve sozinho a cadeia de ids do seu PSP (pedido → cobrança →
   * transação) a partir do que foi gravado no Payment.
   */
  estornarCobranca?(input: {
    /** externalId gravado no Payment (charge, order ou payment-intent). */
    externalId: string;
    /** Id da transação, quando capturado na aprovação — atalho preferido. */
    pspPaymentId?: string | null;
    /** Cartão x PIX: em vários PSPs são rotas diferentes. */
    cartao: boolean;
    /** Valor em reais. Ausente = estorno total. */
    valor?: number;
  }): Promise<void>;

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
  consultarIntencao?(externalId: string): Promise<ResultadoIntencao>;
  cancelarIntencao?(deviceId: string, externalId: string): Promise<void>;
}

// ── Bandeiras ───────────────────────────────────────────────
// Vocabulário único: cada adapter traduz o nome do seu PSP para uma destas, e
// o fiscal traduz daqui para o tBand da SEFAZ. Sem tabela intermediária por
// provedor, sem string solta viajando até a nota.
export const BANDEIRAS = [
  "VISA",
  "MASTERCARD",
  "AMEX",
  "SOROCRED",
  "DINERS",
  "ELO",
  "HIPERCARD",
  "AURA",
  "CABAL",
  "OUTROS",
] as const;

export type Bandeira = (typeof BANDEIRAS)[number];

/**
 * Normaliza o rótulo do PSP para o vocabulário acima. Desconhecido vira
 * "OUTROS" (tBand 99) — nunca null silencioso, nunca palpite.
 */
export function normalizarBandeira(bruta: string | null | undefined): Bandeira | null {
  if (!bruta) return null;
  const s = bruta.toLowerCase().replace(/[\s_-]/g, "");
  if (s.includes("visa")) return "VISA";
  if (s.includes("master") || s.includes("mastercard") || s === "mc") return "MASTERCARD";
  if (s.includes("amex") || s.includes("american")) return "AMEX";
  if (s.includes("sorocred")) return "SOROCRED";
  if (s.includes("diners")) return "DINERS";
  if (s.includes("elo")) return "ELO";
  if (s.includes("hipercard") || s.includes("hiper")) return "HIPERCARD";
  if (s.includes("aura")) return "AURA";
  if (s.includes("cabal")) return "CABAL";
  return "OUTROS";
}

/**
 * CNPJ da credenciadora por PSP — vai no campo card.CNPJ da NFC-e. São CNPJs
 * públicos das instituições, não credencial. Omitir é válido no schema da
 * SEFAZ; mandar errado, não. Se o contador apontar divergência para alguma UF,
 * corrija AQUI — é o único lugar.
 */
export const CNPJ_CREDENCIADORA: Partial<Record<PaymentProviderKind, string>> = {
  MERCADO_PAGO: "10573521000191", // MercadoPago.com Representações Ltda
  STONE: "16501555000157", // Stone Instituição de Pagamento S.A.
  PAGSEGURO: "08561701000101", // PagSeguro Internet Instituição de Pagamento S.A.
};
