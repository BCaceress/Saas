import type { WhatsAppProviderKind } from "@/generated/prisma";

// ============================================================
// Canal WhatsApp — contrato do provedor de disparo.
//
// Mesma ideia do Payment Service: quem manda a cotação fala com esta
// interface, e o adapter concreto (Cloud API da Meta, Simulado) traduz. As
// Compras não sabem que a Meta existe.
//
// Uma regra atravessa tudo: mensagem que a EMPRESA inicia só sai por TEMPLATE
// aprovado. Texto livre é aceito apenas dentro da janela de 24h que o
// fornecedor abre respondendo — e uma cotação nunca começa assim. Por isso o
// contrato tem um método só, e ele é de template.
// ============================================================

/** Parâmetro posicional do corpo do template ({{1}}, {{2}}, …). */
export type ParametroTemplate = string;

export type EnvioTemplate = {
  /** Telefone do contato, só dígitos, com DDI. */
  para: string;
  /**
   * Outras grafias do MESMO número, tentadas só se a operadora do WhatsApp
   * disser que a primeira não é entregável — o caso do nono dígito brasileiro.
   */
  alternativos?: string[];
  template: string;
  idioma: string;
  /** Na ordem em que a Meta aprovou o corpo. */
  parametros: ParametroTemplate[];
};

export type EnvioAceito = {
  /** `wamid.…` — a identidade da mensagem lá fora, e a chave do webhook. */
  externalId: string;
};

export type WhatsAppProvider = {
  readonly kind: WhatsAppProviderKind;
  enviarTemplate(envio: EnvioTemplate): Promise<EnvioAceito>;
  /** Leitura pura: confirma que o token abre o número configurado. */
  validarCredenciais(): Promise<void>;
};

/**
 * Falha vinda do provedor, já traduzida para o operador.
 *
 * `permanente` separa o que adianta tentar de novo do que não adianta: token
 * vencido, template reprovado e número fora do WhatsApp não melhoram com
 * repetição — a tela precisa dizer isso em vez de oferecer "tentar de novo".
 */
export class WhatsAppProviderError extends Error {
  constructor(
    mensagem: string,
    readonly permanente = false,
    readonly codigo: string | null = null,
  ) {
    super(mensagem);
    this.name = "WhatsAppProviderError";
  }
}
