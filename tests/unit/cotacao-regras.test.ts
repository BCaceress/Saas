import { describe, expect, it } from "vitest";
import { regrasDaCotacao, type StatusConvite } from "@/lib/compras/cotacao-regras";

// A regra vale dinheiro: mexer na lista depois que um fornecedor respondeu faz
// o comparativo mentir (totais de listas diferentes lado a lado) e o preço que
// chegou passa a valer para uma pergunta que ninguém fez. Como a MESMA função
// acende os botões na tela e barra a Server Action, um erro aqui vaza para os
// dois lados de uma vez — daí a matriz inteira estar coberta.

const convites = (...status: StatusConvite[]) => status.map((s) => ({ status: s }));

describe("itens", () => {
  it("livre enquanto ninguém respondeu", () => {
    expect(regrasDaCotacao("RASCUNHO", []).itens.pode).toBe(true);
    expect(regrasDaCotacao("RASCUNHO", convites("PENDENTE")).itens.pode).toBe(true);
    expect(regrasDaCotacao("ABERTA", convites("ENVIADA", "ENVIADA")).itens.pode).toBe(true);
  });

  it("congela na primeira resposta, inclusive em rascunho", () => {
    expect(regrasDaCotacao("ABERTA", convites("ENVIADA", "RESPONDIDA")).itens.pode).toBe(false);
    // Resposta registrada à mão (o fornecedor ligou) tranca igual: o que
    // importa é existir proposta, não por qual porta ela entrou.
    expect(regrasDaCotacao("RASCUNHO", convites("RESPONDIDA")).itens.pode).toBe(false);
  });

  it("recusa não é resposta — não há proposta para quebrar", () => {
    expect(regrasDaCotacao("ABERTA", convites("RECUSADA", "ENVIADA")).itens.pode).toBe(true);
  });

  it("encerrada e fechada não aceitam mudança de lista", () => {
    expect(regrasDaCotacao("ENCERRADA", convites("ENVIADA")).itens.pode).toBe(false);
    expect(regrasDaCotacao("DECIDIDA", []).itens.pode).toBe(false);
    expect(regrasDaCotacao("CANCELADA", []).itens.pode).toBe(false);
  });
});

describe("fornecedores", () => {
  it("convidar sobrevive às respostas — mais disputa não invalida proposta", () => {
    expect(regrasDaCotacao("ABERTA", convites("RESPONDIDA")).convidar.pode).toBe(true);
    expect(regrasDaCotacao("RASCUNHO", []).convidar.pode).toBe(true);
  });

  it("convidar para na cotação encerrada ou fechada", () => {
    expect(regrasDaCotacao("ENCERRADA", []).convidar.pode).toBe(false);
    expect(regrasDaCotacao("DECIDIDA", []).convidar.pode).toBe(false);
  });

  it("desconvidar só antes do envio", () => {
    expect(regrasDaCotacao("RASCUNHO", convites("PENDENTE")).desconvidar.pode).toBe(true);
    // Enviada sem nenhuma resposta ainda: o convite já saiu, o fornecedor fica.
    expect(regrasDaCotacao("ABERTA", convites("ENVIADA")).desconvidar.pode).toBe(false);
    expect(regrasDaCotacao("ENCERRADA", []).desconvidar.pode).toBe(false);
    expect(regrasDaCotacao("CANCELADA", []).desconvidar.pode).toBe(false);
  });
});

describe("motivo", () => {
  it("toda negativa explica; toda permissão cala", () => {
    const negadas = [
      regrasDaCotacao("ABERTA", convites("RESPONDIDA")).itens,
      regrasDaCotacao("ABERTA", convites("ENVIADA")).desconvidar,
      regrasDaCotacao("ENCERRADA", []).convidar,
      regrasDaCotacao("DECIDIDA", []).itens,
    ];
    for (const l of negadas) expect(l.motivo).toBeTruthy();
    expect(regrasDaCotacao("RASCUNHO", []).itens.motivo).toBeNull();
  });
});
