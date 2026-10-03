// ── Caixa de entrada das cotações ───────────────────────────
// A lista por data responde "o que eu criei por último". O comprador abre a
// tela com outra pergunta: "o que precisa de mim agora?". Esta função pura
// distribui as cotações vivas em grupos por AÇÃO, na ordem de urgência. Cada
// cotação cai no primeiro grupo que a aceita — nunca em dois.

import type { CotacaoRow } from "./_compra-types";

export type GrupoCaixa =
  | "pedido-parado"
  | "decidir"
  | "prazo"
  | "novas"
  | "rascunho"
  | "aguardando";

export const GRUPOS_CAIXA: Record<GrupoCaixa, { titulo: string; descricao: string }> = {
  "pedido-parado": {
    titulo: "Pedido esperando envio",
    descricao: "A cotação foi concluída, mas o pedido está em rascunho há mais de um dia.",
  },
  decidir: {
    titulo: "Prontas para decidir",
    descricao: "Todo mundo já respondeu — falta escolher de quem comprar.",
  },
  prazo: {
    titulo: "Prazo acabando",
    descricao: "Vence em menos de um dia e ainda tem fornecedor sem responder.",
  },
  novas: {
    titulo: "Respostas novas",
    descricao: "Chegou proposta nas últimas 24 horas.",
  },
  rascunho: {
    titulo: "Para enviar",
    descricao: "Rascunhos que ainda não saíram para os fornecedores.",
  },
  aguardando: {
    titulo: "Aguardando fornecedores",
    descricao: "Enviadas, dentro do prazo. Nada a fazer por enquanto.",
  },
};

const ORDEM: GrupoCaixa[] = ["pedido-parado", "decidir", "prazo", "novas", "rascunho", "aguardando"];

const DIA = 24 * 60 * 60 * 1000;

export function grupoDaCotacao(l: CotacaoRow, agora: number): GrupoCaixa | null {
  const pendentes = l.totalConvidados - l.totalRespondidos - l.totalRecusados;
  if (l.status === "DECIDIDA") return l.pedidosParados > 0 ? "pedido-parado" : null;
  if (l.status === "RASCUNHO") return "rascunho";
  if (l.status === "ENCERRADA") return l.totalRespondidos > 0 ? "decidir" : null;
  if (l.status !== "ABERTA") return null;

  if (l.totalRespondidos > 0 && pendentes <= 0) return "decidir";
  if (pendentes > 0 && l.prazoResposta && new Date(l.prazoResposta).getTime() - agora < DIA) {
    return "prazo";
  }
  if (l.ultimaRespostaEm && agora - new Date(l.ultimaRespostaEm).getTime() < DIA) return "novas";
  return "aguardando";
}

export function agruparCaixa(
  linhas: CotacaoRow[],
  agora: number,
): { grupo: GrupoCaixa; linhas: CotacaoRow[] }[] {
  const porGrupo = new Map<GrupoCaixa, CotacaoRow[]>();
  for (const l of linhas) {
    const g = grupoDaCotacao(l, agora);
    if (!g) continue;
    const lista = porGrupo.get(g) ?? [];
    lista.push(l);
    porGrupo.set(g, lista);
  }
  // Dentro do grupo, o mais urgente primeiro: prazo mais perto, resposta mais
  // nova, rascunho da repetição antes do feito à mão.
  const chave = (g: GrupoCaixa, l: CotacaoRow): number => {
    if (g === "prazo") return new Date(l.prazoResposta!).getTime();
    if (g === "novas") return -new Date(l.ultimaRespostaEm!).getTime();
    if (g === "rascunho") return l.geradaPorRecorrencia ? 0 : 1;
    return -new Date(l.criadaEm).getTime();
  };
  return ORDEM.flatMap((g) => {
    const lista = porGrupo.get(g);
    if (!lista?.length) return [];
    return [{ grupo: g, linhas: [...lista].sort((a, b) => chave(g, a) - chave(g, b)) }];
  });
}
