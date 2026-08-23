/**
 * Intenção passada pela URL (`?acao=perda`) — o bipe COM propósito.
 *
 * Existe porque a folha "Nova operação" tem verbos que precisam de um PRODUTO
 * (perda, transferência, ajuste). Sem um alvo, esses itens só sabiam despejar a
 * pessoa na lista de estoque; agora eles abrem o scanner, e o produto lido já
 * sobe com a folha da ação aberta.
 *
 * Módulo neutro (sem "use client"): quem valida o parâmetro são as páginas
 * `/m/scan` e `/m/produto/[id]`, que rodam no servidor, e quem consome o valor
 * é a barra de ações, que é client. Os rótulos ficam junto da lista para que
 * acrescentar uma ação seja mexer em um lugar só.
 */

export const ACOES_URL = [
  "perda",
  "ajuste",
  "transferencia",
  "preco",
  "promocao",
  "pedir",
] as const;

/** Espelha `AcaoInicial["chave"]` de `acoes-produto` — menos "etiqueta", que está fora do ar. */
export type AcaoUrl = (typeof ACOES_URL)[number];

/** Título da tela quando o scanner é aberto com intenção. */
export const TITULO_ACAO: Record<AcaoUrl, string> = {
  perda: "Registrar perda",
  ajuste: "Ajustar saldo",
  transferencia: "Transferir",
  preco: "Alterar preço",
  promocao: "Promoção",
  pedir: "Pedido de compra",
};

/** O que fazer agora. Genérico não ajuda quem já sabe o que veio fazer. */
export const DICA_ACAO: Record<AcaoUrl, string> = {
  perda: "Bipe o produto que quebrou, venceu ou avariou.",
  ajuste: "Bipe o produto para corrigir o saldo.",
  transferencia: "Bipe o produto que vai para outra loja.",
  preco: "Bipe o produto para mudar o preço.",
  promocao: "Bipe o produto que entra em promoção.",
  pedir: "Bipe o produto que falta para pedir ao fornecedor.",
};

/** Valida o parâmetro cru da URL. Qualquer outra coisa é ignorada em silêncio. */
export function acaoDaUrl(valor: string | undefined): AcaoUrl | null {
  return ACOES_URL.includes(valor as AcaoUrl) ? (valor as AcaoUrl) : null;
}
