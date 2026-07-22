import type { TipoItemPedido, MotivoBonificacao } from "@/lib/estoque";

export type { TipoItemPedido, MotivoBonificacao };

/** Ordem de exibição — COMPRA primeiro, depois os tipos sem custo. */
export const TIPOS_SEM_CUSTO: TipoItemPedido[] = ["BONIFICACAO", "BRINDE", "TROCA", "AMOSTRA", "SERVICO"];

export const TIPO_ITEM_LABEL: Record<TipoItemPedido, string> = {
  COMPRA: "Compra",
  BONIFICACAO: "Bonificação",
  BRINDE: "Brinde",
  TROCA: "Troca",
  AMOSTRA: "Amostra",
  SERVICO: "Serviço",
};

export const MOTIVO_BONIFICACAO_LABEL: Record<MotivoBonificacao, string> = {
  COMERCIAL: "Bonificação comercial",
  CAMPANHA: "Campanha",
  REPOSICAO: "Reposição",
  TROCA: "Troca",
  CORTESIA: "Cortesia",
  OUTRO: "Outro",
};

export const MOTIVO_BONIFICACAO_OPTIONS: { value: MotivoBonificacao; label: string }[] = (
  Object.keys(MOTIVO_BONIFICACAO_LABEL) as MotivoBonificacao[]
).map((value) => ({ value, label: MOTIVO_BONIFICACAO_LABEL[value] }));
