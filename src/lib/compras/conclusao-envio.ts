// ============================================================
// Conclusão da cotação: enviar o pedido já, ou revisar antes?
//
// Concluir continua criando o pedido em RASCUNHO — é a única forma de a
// decisão existir antes de a promessa sair. O que muda é o passo seguinte:
// para cada fornecedor, a tela sugere "enviar agora" quando NADA indica que o
// pedido precisa de ajuste, e "revisar antes" quando algo indica. A sugestão
// é só isso — o operador troca. A exceção é não ter para quem mandar: aí não
// há como enviar.
//
// Função pura: a mesma regra serve ao desktop, ao celular e aos testes.
// ============================================================

export type EntradaAvisoEnvio = {
  /** Itens escolhidos deste fornecedor que não têm produto no catálogo (ficam fora do pedido). */
  itensForaDoCatalogo: number;
  /** Itens que vão acima da quantidade cotada (promoção por volume levada). */
  itensAcimaDoCotado: number;
  /** Itens com marca diferente da cotada por outro fornecedor. */
  itensComMarcaDivergente: number;
  total: number;
  pedidoMinimo: number | null;
  /** A proposta foi digitada pela loja, não pelo fornecedor. */
  respostaManual: boolean;
  /** Prazo de pagamento não entendido. */
  prazoDesconhecido: boolean;
  /** Tem telefone ou e-mail para mandar. */
  temContato: boolean;
  /** Já existe pedido vivo desta cotação para este fornecedor (reabertura). */
  jaTemPedido: boolean;
};

export type DecisaoEnvio = {
  /** Motivo que impede enviar agora. null = pode. */
  bloqueio: string | null;
  /** Motivos para conferir antes. Vazio = pedido limpo. */
  avisos: string[];
  sugestao: "enviar" | "revisar";
};

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function decidirEnvio(e: EntradaAvisoEnvio): DecisaoEnvio {
  if (e.jaTemPedido) {
    return {
      bloqueio: "Já existe pedido desta cotação para este fornecedor — nenhum novo será criado.",
      avisos: [],
      sugestao: "revisar",
    };
  }

  const avisos: string[] = [];
  if (e.itensForaDoCatalogo > 0) {
    avisos.push(`${plural(e.itensForaDoCatalogo, "item fica", "itens ficam")} fora (sem produto no catálogo)`);
  }
  if (e.pedidoMinimo !== null && e.pedidoMinimo > 0 && e.total < e.pedidoMinimo) {
    avisos.push(
      `abaixo do pedido mínimo de ${e.pedidoMinimo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
    );
  }
  if (e.itensAcimaDoCotado > 0) {
    avisos.push(`${plural(e.itensAcimaDoCotado, "item vai", "itens vão")} acima da quantidade cotada`);
  }
  if (e.itensComMarcaDivergente > 0) {
    avisos.push(`${plural(e.itensComMarcaDivergente, "item com marca", "itens com marca")} diferente`);
  }
  if (e.respostaManual) avisos.push("proposta digitada pela loja — confira os preços");
  if (e.prazoDesconhecido) avisos.push("prazo de pagamento não informado");

  const bloqueio = e.temContato ? null : "Sem telefone ou e-mail cadastrado para enviar.";
  return {
    bloqueio,
    avisos,
    sugestao: bloqueio || avisos.length > 0 ? "revisar" : "enviar",
  };
}
