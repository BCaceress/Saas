import { TOL_QTD } from "./conciliacao-regras";
import type { PurchaseOrderStatus } from "@/generated/prisma";

// ============================================================
// As regras do recebimento — puras, sem I/O.
//
// Separadas do serviço pelo mesmo motivo de `conciliacao-regras`: "este pedido
// já chegou por inteiro?" e "o que ainda não foi explicado?" são as duas
// perguntas que decidem se o estoque se move, e certeza aqui se prova com
// teste, não com clique na tela.
//
// Tudo em UNIDADE BASE do estoque. Converter é responsabilidade de quem chama.
// ============================================================

/** Diferença entre o que se esperava e o que foi contado, linha a linha. */
export type Divergencia = {
  itemId: string;
  descricao: string;
  esperado: number;
  recebido: number;
};

/** A linha da conferência, no mínimo que estas regras precisam enxergar. */
export type LinhaConferida = {
  id: string;
  descricao: string;
  qtdPedida: unknown;
  qtdFaturada: unknown;
  qtdRecebida: unknown;
  resolucao: unknown;
  motivoDivergencia?: unknown;
};

/**
 * O que a linha esperava receber.
 *
 * Com nota, é o que o fornecedor faturou; sem ela, o que o pedido combinou. A
 * ordem importa: a nota é mais recente que o pedido, e é contra ela que a
 * mercadoria na porta é conferida quando as duas existem.
 */
export function esperadoDaLinha(l: Pick<LinhaConferida, "qtdPedida" | "qtdFaturada">): number {
  return Number(l.qtdFaturada) || Number(l.qtdPedida);
}

/**
 * O que ainda não foi explicado.
 *
 * "AJUSTADO" NÃO conta como explicação: ele só registra que alguém digitou um
 * número diferente do esperado. O que encerra a pendência é uma frase — a do
 * item (`motivoDivergencia`, escrita ao resolver a linha) ou a do recebimento
 * inteiro, pedida uma única vez no fechamento. Sem isso, a diferença vira,
 * meses depois, a palavra do estoquista contra a do fornecedor.
 *
 * Linha nunca contada não é divergência: ela entra pelo esperado.
 */
export function divergenciasDaConferencia(linhas: LinhaConferida[]): Divergencia[] {
  return linhas
    .filter((l) => !l.motivoDivergencia && l.resolucao !== "ACEITO" && l.resolucao !== "IGNORADO")
    .map((l) => {
      const esperado = esperadoDaLinha(l);
      const recebido = l.qtdRecebida == null ? esperado : Number(l.qtdRecebida);
      return { itemId: l.id, descricao: l.descricao, esperado, recebido };
    })
    .filter((d) => Math.abs(d.recebido - d.esperado) > TOL_QTD);
}

/**
 * Status do pedido derivado do saldo dos itens.
 *
 * Derivado, nunca digitado: "parcialmente recebido" é uma leitura do saldo, não
 * uma decisão de alguém. E nada aqui reflete a doca — "em conferência" é estado
 * do RECEBIMENTO e não sobe para o pedido: o pedido segue confirmado enquanto
 * alguém conta caixa na porta.
 *
 * Rascunho e cancelado não se movem por saldo: um não foi enviado, o outro não
 * espera mais nada.
 */
export function statusDoPedidoPeloSaldo(
  itens: { qtdPedida: unknown; qtdRecebida: unknown }[],
  atual: PurchaseOrderStatus,
): PurchaseOrderStatus {
  if (atual === "CANCELADO" || atual === "RASCUNHO") return atual;
  if (itens.length === 0) return atual;

  const completo = itens.every((i) => Number(i.qtdRecebida) >= Number(i.qtdPedida) - TOL_QTD);
  if (completo) return "RECEBIDO";

  const algum = itens.some((i) => Number(i.qtdRecebida) > TOL_QTD);
  return algum ? "RECEBIDO_PARCIAL" : atual;
}
