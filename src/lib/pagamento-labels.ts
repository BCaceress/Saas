import type { PaymentMethod } from "@/generated/prisma";

/**
 * Rótulos de método de pagamento em pt-BR.
 *
 * Este mapa já existia copiado em `vendas/_fila.tsx`, `vendas/_historico.tsx`,
 * `vendas/_modais.tsx` e `lib/analises/fatos/venda-item.ts` — com textos
 * diferentes entre si ("Cartão de crédito" numa tela, "Crédito" na outra). A
 * superfície mobile precisava do mesmo mapa; em vez da quinta cópia, a fonte
 * passa a ser esta. As telas de desktop ainda apontam para as próprias cópias:
 * migrá-las é limpeza à parte, sem ligação com o que o mobile precisa hoje.
 *
 * Sem `server-only`: é texto de interface, usado dos dois lados.
 */

/** Forma curta — cabe em cápsula, célula de tabela e tela de celular. */
export const METODO_LABEL: Record<PaymentMethod, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CARTAO_CREDITO: "Crédito",
  CARTAO_DEBITO: "Débito",
  OUTRO: "Outro",
};

/** Forma longa — recibo, relatório impresso, confirmação. */
export const METODO_LABEL_LONGO: Record<PaymentMethod, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CARTAO_CREDITO: "Cartão de crédito",
  CARTAO_DEBITO: "Cartão de débito",
  OUTRO: "Outro",
};

/** Aceita string crua do banco sem quebrar se surgir um método novo. */
export function metodoLabel(metodo: string | null | undefined): string {
  if (!metodo) return "—";
  return METODO_LABEL[metodo as PaymentMethod] ?? metodo;
}

/** Origem da venda — de onde ela entrou. */
export const ORIGEM_LABEL: Record<string, string> = {
  PDV: "PDV",
  TOTEM: "Autoatendimento",
  APP: "App",
  ONLINE: "Online",
};

export function origemLabel(origem: string): string {
  return ORIGEM_LABEL[origem] ?? origem;
}
