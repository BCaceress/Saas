import type {
  Atendimento,
  PaymentMethod,
  Plan,
  Topologia,
  TipoOperacao,
} from "@/generated/prisma";

/**
 * Motor de presets (PRD §6). O "tipo de operação" só escolhe defaults sobre três
 * eixos ortogonais (Atendimento, Topologia, Mix) + toggles de módulo. Tudo
 * sobrescrevível depois nas configurações.
 */

export type ModuleToggles = {
  moduloPdv: boolean;
  moduloFiscal: boolean;
  moduloComodato: boolean;
  moduloRota: boolean;
};

export type Preset = {
  atendimento: Atendimento;
  topologia: Topologia;
  toggles: ModuleToggles;
  // pergunta específica do tipo decide um toggle "perguntado"
  pergunta?: "comodato" | "fiscal" | "pagamento";
  vocabularioPonto: string; // "Loja" | "Ponto"
};

export const PRESETS: Record<TipoOperacao, Preset> = {
  AUTONOMO: {
    atendimento: "SELF_SERVICE",
    topologia: "CD_ABASTECE",
    toggles: { moduloPdv: false, moduloFiscal: false, moduloComodato: false, moduloRota: true },
    pergunta: "pagamento",
    vocabularioPonto: "Ponto",
  },
  MERCADINHO: {
    atendimento: "OPERADOR_PDV",
    topologia: "LOCAL",
    toggles: { moduloPdv: true, moduloFiscal: false, moduloComodato: false, moduloRota: false },
    pergunta: "fiscal",
    vocabularioPonto: "Loja",
  },
  CONVENIENCIA_BEBIDAS: {
    atendimento: "OPERADOR_PDV",
    topologia: "LOCAL",
    toggles: { moduloPdv: true, moduloFiscal: true, moduloComodato: false, moduloRota: false },
    pergunta: "comodato",
    vocabularioPonto: "Loja",
  },
};

export const TIPO_LABELS: Record<TipoOperacao, { nome: string; desc: string }> = {
  AUTONOMO: {
    nome: "Mercado autônomo",
    desc: "Self-service, cliente paga sozinho. Sem operador no caixa.",
  },
  MERCADINHO: {
    nome: "Mercadinho",
    desc: "Operador no caixa, atendimento no balcão.",
  },
  CONVENIENCIA_BEBIDAS: {
    nome: "Conveniência de bebidas",
    desc: "Adega/conveniência com foco em bebida e PDV.",
  },
};

/** Métodos de pagamento default por tipo de atendimento (PRD Fase 4 §6). */
export function defaultPaymentMethods(atendimento: Atendimento | null): PaymentMethod[] {
  if (atendimento === "SELF_SERVICE") {
    return ["PIX", "CARTAO_CREDITO", "CARTAO_DEBITO"];
  }
  // OPERADOR_PDV (default)
  return ["DINHEIRO", "CARTAO_CREDITO", "CARTAO_DEBITO", "PIX"];
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  DINHEIRO: "Dinheiro",
  CARTAO_CREDITO: "Cartão de crédito",
  CARTAO_DEBITO: "Cartão de débito",
  PIX: "Pix",
  OUTRO: "Outro",
};

/** Tier sugerido a partir do nº de pontos. */
export function tierFromPontos(faixa: "1" | "2-5" | "6+"): Plan {
  if (faixa === "6+") return "MULTI";
  if (faixa === "2-5") return "PRO";
  return "STARTER";
}
