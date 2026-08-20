// ── Status que o operador lê ────────────────────────────────
// O enum do banco tem 5 estados (RASCUNHO/ABERTA/ENCERRADA/DECIDIDA/CANCELADA)
// e isso basta para o ciclo de vida. Mas "ABERTA" não diz o que o comprador
// quer saber: se alguém já respondeu. Em vez de criar coluna nova — que
// mentiria assim que uma resposta entrasse por outro caminho —, o rótulo é
// DERIVADO da contagem de convites, sempre na hora da leitura.

import type { CotacaoStatus } from "./_compra-types";

export type StatusVisivel =
  | "RASCUNHO"
  | "ENVIADA"
  | "AGUARDANDO"
  | "PARCIAL"
  | "RESPONDIDA"
  | "ENCERRADA"
  | "DECIDIDA"
  | "CANCELADA";

export type Rotulo = { id: StatusVisivel; label: string; classe: string };

const ROTULOS: Record<StatusVisivel, Rotulo> = {
  RASCUNHO: { id: "RASCUNHO", label: "Rascunho", classe: "bg-surface-2 text-muted" },
  ENVIADA: { id: "ENVIADA", label: "Enviada", classe: "bg-brand-soft text-brand" },
  AGUARDANDO: { id: "AGUARDANDO", label: "Aguardando respostas", classe: "bg-brand-soft text-brand" },
  PARCIAL: {
    id: "PARCIAL",
    label: "Parcialmente respondida",
    classe: "bg-accent-soft text-accent",
  },
  RESPONDIDA: { id: "RESPONDIDA", label: "Respondida", classe: "bg-ok-soft text-ok" },
  ENCERRADA: { id: "ENCERRADA", label: "Encerrada", classe: "bg-accent-soft text-accent" },
  DECIDIDA: { id: "DECIDIDA", label: "Virou pedido", classe: "bg-ok-soft text-ok" },
  CANCELADA: { id: "CANCELADA", label: "Cancelada", classe: "bg-surface-2 text-faint" },
};

/**
 * Rótulo da cotação. A contagem de convites só importa enquanto ela está
 * ABERTA — depois de encerrada ou decidida, o que manda é o estado do banco.
 *
 * Quem recusou ("não vou cotar") não conta como resposta, mas também não é
 * mais espera: sai da conta dos dois lados. Cotação onde todo mundo recusou
 * fica em "Aguardando" de propósito — ninguém cotou, e fingir que terminou
 * esconderia justamente o problema.
 */
export function statusVisivel(
  status: CotacaoStatus,
  convidados: number,
  respondidos: number,
  recusados = 0,
): Rotulo {
  if (status !== "ABERTA") return ROTULOS[status];
  if (convidados === 0) return ROTULOS.ENVIADA;
  if (respondidos === 0) return ROTULOS.AGUARDANDO;
  const pendentes = convidados - respondidos - recusados;
  return pendentes > 0 ? ROTULOS.PARCIAL : ROTULOS.RESPONDIDA;
}

/** Texto curto do andamento, para a linha de apoio ("2 de 4 responderam"). */
export function andamento(convidados: number, respondidos: number): string {
  if (convidados === 0) return "nenhum fornecedor convidado";
  if (respondidos === 0) {
    return `${convidados} ${convidados === 1 ? "fornecedor" : "fornecedores"} · nenhuma resposta`;
  }
  return `${respondidos} de ${convidados} responderam`;
}
