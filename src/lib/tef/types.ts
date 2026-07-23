import type { Bandeira } from "@/lib/pagamentos/types";

// ============================================================
// Contrato do gerenciador TEF local (PayGo Integrado, SiTef/CliSiTef, …).
//
// ONDE RODA: no processo NATIVO do PDV (Electron main / agente local), NUNCA no
// servidor Next. O pinpad está fisicamente na máquina do caixa — só um processo
// local alcança a DLL/porta serial/bridge HTTP do gerenciador. O renderer (o
// React do PDV) fala com esse processo por IPC; o adapter concreto implementa
// este contrato do outro lado.
//
// POR QUE UM CONTRATO: a escolha do gerenciador (PayGo x SiTef) é comercial e
// posterior. Trocar de gerenciador = escrever outro adapter, sem tocar no PDV —
// o mesmo padrão do Payment Service (src/lib/pagamentos).
//
// TEF É DOIS-FASES: `pagar` autoriza mas deixa a transação PENDENTE de
// confirmação. Só depois de a venda ser gravada com sucesso o fluxo chama
// `confirmar`; se a gravação falhar, chama `desfazer`. Sem isso, dinheiro
// autorizado sem venda (ou venda sem dinheiro) — o clássico furo de TEF.
// ============================================================

export type TefTipoCartao = "CREDITO" | "DEBITO" | "VOUCHER";

/** Quem financia o parcelamento (define juros e repasse). */
export type TefParcelamento = "A_VISTA" | "LOJA" | "ADMINISTRADORA";

export type TefStatus = "APROVADO" | "RECUSADO" | "CANCELADO" | "ERRO";

/**
 * Resultado normalizado de uma operação no pinpad. Os campos de comprovante e
 * conciliação só vêm preenchidos quando `status === "APROVADO"`.
 */
export type TefResultado = {
  status: TefStatus;
  /** Motivo quando não aprovado (mensagem do gerenciador, já legível). */
  mensagem?: string;

  /** Bandeira normalizada (VISA, MASTERCARD, ELO, …) → alimenta a NFC-e. */
  bandeira: Bandeira | null;
  parcelas: number | null;
  /** NSU do TEF (número sequencial único). */
  nsu: string | null;
  /** Código de autorização do adquirente → cAut da NFC-e. */
  autorizacao: string | null;
  /** Adquirente/rede que capturou (Cielo, Rede, GetNet, Stone…). */
  adquirente: string | null;
  /** CNPJ da credenciadora, quando o gerenciador informa → card.CNPJ da NFC-e. */
  adquirenteCnpj: string | null;

  /** Vias do comprovante para impressão (cliente e loja). */
  comprovanteCliente: string | null;
  comprovanteLoja: string | null;

  /** Id da transação no TEF — necessário para confirmar/desfazer/cancelar. */
  tefId: string | null;
};

export interface TefProvider {
  slug: string; // "PAYGO" | "SITEF" | "SIMULADO"

  /**
   * Cobra no pinpad. Bloqueia até o cliente concluir ou cancelar. A transação
   * volta APROVADA porém PENDENTE de confirmação (ver dois-fases acima).
   */
  pagar(input: {
    /** Valor em reais. */
    valor: number;
    tipo: TefTipoCartao;
    parcelas?: number;
    parcelamento?: TefParcelamento;
    /** Rótulo do PDV (número da venda) — vai ao comprovante e à conciliação. */
    referencia: string;
  }): Promise<TefResultado>;

  /** Confirma a transação aprovada (2ª fase). Sem isso, o TEF a desfaz sozinho. */
  confirmar(input: { tefId: string }): Promise<void>;

  /** Desfaz (rollback) uma transação aprovada mas ainda não confirmada. */
  desfazer(input: { tefId: string }): Promise<void>;

  /**
   * Cancela/estorna uma transação JÁ CONFIRMADA (em geral no mesmo dia, antes
   * do fechamento do lote). Passa pelo pinpad — o cliente costuma precisar
   * inserir o cartão de novo.
   */
  cancelar(input: { tefId: string; valor: number }): Promise<TefResultado>;

  /**
   * Fechamento do lote / confirmação de pendências no início do dia. Chamado na
   * abertura do caixa para resolver transações que ficaram em aberto (queda de
   * energia no meio de um pagamento, etc.).
   */
  resolverPendencias?(): Promise<void>;
}
