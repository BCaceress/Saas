// ============================================================
// O que ainda dá para mudar numa cotação.
//
// Cotação é uma pergunta feita a terceiros. Enquanto ninguém respondeu, mudar
// a pergunta é de graça. Depois da primeira resposta, mexer na LISTA quebra a
// comparação: o fornecedor A cotou oito itens, o B cotaria nove, e os totais
// deixam de falar da mesma coisa — pior, o preço que o A mandou passa a valer
// para uma lista que não existe mais.
//
// A régua:
//   ITENS        → só enquanto NÃO existe resposta (em RASCUNHO ou ABERTA).
//   + FORNECEDOR → enquanto a cotação está viva. Mais gente na disputa nunca
//                  invalida o que já foi respondido.
//   − FORNECEDOR → só em RASCUNHO. Depois de enviada, tirar alguém apaga o
//                  convite de quem já foi incomodado — e que pode estar
//                  preenchendo o link neste minuto.
//
// Função pura sobre o status: quem passa os dados é o loader da tela (no
// cliente) ou a própria Server Action (no servidor). As duas pontas leem a
// MESMA regra, então nenhum botão fica aceso para uma ação que o servidor vai
// recusar — e nenhuma trava vive só no cliente, onde não vale nada.
// ============================================================

export type StatusCotacao = "RASCUNHO" | "ABERTA" | "ENCERRADA" | "DECIDIDA" | "CANCELADA";
export type StatusConvite = "PENDENTE" | "ENVIADA" | "RESPONDIDA" | "RECUSADA";

/** Uma permissão e, quando negada, a frase que explica o porquê ao operador. */
export type Licenca = { pode: boolean; motivo: string | null };

export type RegrasCotacao = {
  /** DECIDIDA ou CANCELADA: virou histórico, nada mais muda. */
  fechada: boolean;
  /** Alguém já mandou preço. Recusa não conta — não há proposta para quebrar. */
  temResposta: boolean;
  /** Adicionar, alterar quantidade e remover item. */
  itens: Licenca;
  /** Chamar mais um fornecedor para a disputa. */
  convidar: Licenca;
  /** Tirar um fornecedor da cotação. */
  desconvidar: Licenca;
};

const LIVRE: Licenca = { pode: true, motivo: null };
const nao = (motivo: string): Licenca => ({ pode: false, motivo });

const FECHADA = "Esta cotação já foi fechada e não aceita mais mudanças.";

export function regrasDaCotacao(
  status: StatusCotacao,
  convites: { status: StatusConvite }[],
): RegrasCotacao {
  const fechada = status === "DECIDIDA" || status === "CANCELADA";
  const temResposta = convites.some((c) => c.status === "RESPONDIDA");
  const montando = status === "RASCUNHO";
  const viva = montando || status === "ABERTA";

  const itens: Licenca = fechada
    ? nao(FECHADA)
    : temResposta
      ? nao(
          "Um fornecedor já respondeu — mudar a lista agora invalidaria a proposta dele. Duplique a cotação para pedir preço de uma lista diferente.",
        )
      : viva
        ? LIVRE
        : nao("A cotação está encerrada. Reabra para mexer na lista de itens.");

  const convidar: Licenca = fechada
    ? nao(FECHADA)
    : viva
      ? LIVRE
      : nao("A cotação está encerrada. Reabra para convidar mais fornecedores.");

  const desconvidar: Licenca = fechada
    ? nao(FECHADA)
    : montando
      ? LIVRE
      : nao(
          "A cotação já foi enviada — o fornecedor não sai mais dela. Ele pode marcar que não vai cotar, e a proposta dele simplesmente não entra na decisão.",
        );

  return { fechada, temResposta, itens, convidar, desconvidar };
}
