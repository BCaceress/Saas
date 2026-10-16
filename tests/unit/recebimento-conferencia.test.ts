import { describe, expect, it } from "vitest";
import {
  avisoDeValidade,
  custoDeEntradaDaLinha,
  divergenciasDaConferencia,
  esperadoDaLinha,
  frasesDeDivergencia,
  linhasParaConferirTudo,
  quantidadeQueEntra,
  type LinhaConferida,
  type LinhaParaFornecedor,
} from "@/lib/compras/recebimento-regras";

// As regras que decidem O QUE entra no estoque e POR QUANTO quando a doca
// fecha o recebimento — e o que a tela promete antes do clique. Tudo em
// unidade base: "1 CX c/ 12" já chega aqui como 12.

const linha = (over: Partial<LinhaConferida> = {}): LinhaConferida => ({
  id: "l1",
  descricao: "Cerveja lata 350ml",
  qtdPedida: 120,
  qtdFaturada: 120,
  qtdRecebida: null,
  resolucao: null,
  motivoDivergencia: null,
  status: "OK",
  ...over,
});

describe("esperadoDaLinha — o que a nota não trouxe", () => {
  it("item do pedido que não veio na nota espera ZERO, não a quantidade pedida", () => {
    // Antes: caía no pedido (120) e a linha que ninguém contou entrava no
    // estoque a custo zero — e o pedido fechava como recebido.
    expect(esperadoDaLinha({ qtdPedida: 120, qtdFaturada: 0, status: "NAO_FATURADO" })).toBe(0);
  });

  it("pedido sem nota continua esperando o pedido", () => {
    expect(esperadoDaLinha({ qtdPedida: 40, qtdFaturada: 0, status: "OK" })).toBe(40);
  });

  it("sem status informado, mantém a regra de sempre", () => {
    expect(esperadoDaLinha({ qtdPedida: 40, qtdFaturada: 0 })).toBe(40);
  });
});

describe("quantidadeQueEntra", () => {
  it("o contado manda, quando alguém contou", () => {
    expect(quantidadeQueEntra(linha({ qtdRecebida: 96 }))).toBe(96);
  });

  it("contagem zero é zero — não cai no esperado", () => {
    expect(quantidadeQueEntra(linha({ qtdRecebida: 0 }))).toBe(0);
  });

  it("sem contagem entra o esperado", () => {
    expect(quantidadeQueEntra(linha())).toBe(120);
  });

  it("NAO_FATURADO sem contagem não entra nada", () => {
    expect(
      quantidadeQueEntra(linha({ status: "NAO_FATURADO", qtdFaturada: 0, qtdRecebida: null })),
    ).toBe(0);
  });
});

describe("divergenciasDaConferencia com linha não faturada", () => {
  it("não faturado e não contado não é divergência da contagem", () => {
    const l = linha({ status: "NAO_FATURADO", qtdFaturada: 0, qtdRecebida: null });
    expect(divergenciasDaConferencia([l])).toHaveLength(0);
  });

  it("não faturado que chegou mesmo assim pede explicação", () => {
    const l = linha({ status: "NAO_FATURADO", qtdFaturada: 0, qtdRecebida: 24 });
    expect(divergenciasDaConferencia([l])[0]).toMatchObject({ esperado: 0, recebido: 24 });
  });
});

describe("custoDeEntradaDaLinha", () => {
  const base = { custoPedido: 6.5, custoFaturado: 7, bonificacao: false, status: "OK" };

  it("entra pelo custo da nota — é o que vai ser pago", () => {
    expect(custoDeEntradaDaLinha(base)).toBe(7);
  });

  it("bonificação entra sem custo", () => {
    expect(custoDeEntradaDaLinha({ ...base, bonificacao: true })).toBe(0);
  });

  it("não faturado que chegou entra pelo preço do pedido, não a zero", () => {
    expect(
      custoDeEntradaDaLinha({ ...base, status: "NAO_FATURADO", custoFaturado: 0 }),
    ).toBe(6.5);
  });

  it("linha da nota faturada a zero continua zero — a nota é a verdade", () => {
    expect(custoDeEntradaDaLinha({ ...base, custoFaturado: 0 })).toBe(0);
  });

  it("aceita Decimal-like (string) do banco", () => {
    expect(custoDeEntradaDaLinha({ ...base, custoFaturado: "7.25" })).toBe(7.25);
  });
});

describe("linhasParaConferirTudo", () => {
  it("preenche só o que ninguém contou", () => {
    const r = linhasParaConferirTudo([
      linha({ id: "a", qtdRecebida: null }),
      linha({ id: "b", qtdRecebida: 100 }),
    ]);
    expect(r).toEqual([{ id: "a", qtdRecebida: 120 }]);
  });

  it("não zera a linha acrescentada na doca (sem nota nem pedido)", () => {
    // Antes o clique gravava `qtdFaturada || qtdPedida` = 0 por cima das 6
    // caixas contadas do item que veio a mais.
    const avulsa = linha({ id: "x", qtdPedida: 0, qtdFaturada: 0, qtdRecebida: 72, status: "NAO_PEDIDO" });
    expect(linhasParaConferirTudo([avulsa])).toEqual([]);
  });

  it("não faturado vira contagem zero — nada entra por ele", () => {
    const l = linha({ id: "nf", status: "NAO_FATURADO", qtdFaturada: 0 });
    expect(linhasParaConferirTudo([l])).toEqual([{ id: "nf", qtdRecebida: 0 }]);
  });

  it("pedido sem nota: preenche com o saldo do pedido", () => {
    const l = linha({ id: "p", qtdPedida: 40, qtdFaturada: 40 });
    expect(linhasParaConferirTudo([l])).toEqual([{ id: "p", qtdRecebida: 40 }]);
  });
});

describe("avisoDeValidade", () => {
  const hoje = "2026-10-15";

  it("validade passada é vencida, com os dias", () => {
    expect(avisoDeValidade("2026-10-12", hoje, 30)).toEqual({ tipo: "VENCIDO", dias: 3 });
  });

  it("vence hoje é aviso, não vencido", () => {
    expect(avisoDeValidade("2026-10-15", hoje, 30)).toEqual({ tipo: "VENCE_LOGO", dias: 0 });
  });

  it("dentro do alerta da loja avisa", () => {
    expect(avisoDeValidade("2026-11-14", hoje, 30)).toEqual({ tipo: "VENCE_LOGO", dias: 30 });
  });

  it("fora do alerta não diz nada", () => {
    expect(avisoDeValidade("2026-11-15", hoje, 30)).toBeNull();
  });

  it("sem validade, sem aviso", () => {
    expect(avisoDeValidade(null, hoje, 30)).toBeNull();
    expect(avisoDeValidade("", hoje, 30)).toBeNull();
  });

  it("atravessa mês e ano sem errar a conta", () => {
    expect(avisoDeValidade("2027-01-02", "2026-12-30", 7)).toEqual({ tipo: "VENCE_LOGO", dias: 3 });
  });

  it("aceita data com hora (ISO) — compara só o dia", () => {
    expect(avisoDeValidade("2026-10-14T00:00:00.000Z", hoje, 30)).toEqual({ tipo: "VENCIDO", dias: 1 });
  });
});

describe("frasesDeDivergencia", () => {
  const l = (over: Partial<LinhaParaFornecedor>): LinhaParaFornecedor => ({
    descricao: "Heineken LN 330",
    status: "OK",
    qtdPedida: 120,
    qtdFaturada: 120,
    qtdRecebida: null,
    custoPedido: 5,
    custoFaturado: 5,
    motivoDivergencia: null,
    avulsa: false,
    ...over,
  });

  it("linha que bateu não vira frase", () => {
    expect(frasesDeDivergencia([l({}), l({ qtdRecebida: 120 })], { temNota: true })).toEqual([]);
  });

  it("a caixa contra o papel — a reclamação mais comum, que antes ficava de fora", () => {
    expect(frasesDeDivergencia([l({ qtdRecebida: 96 })], { temNota: true })).toEqual([
      "• Heineken LN 330: a nota diz 120, chegaram 96",
    ]);
  });

  it("sem nota, a referência é o pedido", () => {
    expect(
      frasesDeDivergencia([l({ qtdFaturada: 0, qtdRecebida: 100 })], { temNota: false }),
    ).toEqual(["• Heineken LN 330: o pedido diz 120, chegaram 100"]);
  });

  it("nota contra pedido e contagem na mesma frase", () => {
    const [f] = frasesDeDivergencia(
      [l({ status: "FALTANDO", qtdFaturada: 96, qtdRecebida: 90 })],
      { temNota: true },
    );
    expect(f).toBe("• Heineken LN 330: pedimos 120, a nota trouxe 96; a nota diz 96, chegaram 90");
  });

  it("preço diferente do combinado", () => {
    const [f] = frasesDeDivergencia(
      [l({ status: "PRECO_ALTERADO", custoFaturado: 5.5 })],
      { temNota: true },
    );
    expect(f).toContain("preço combinado");
    expect(f).toContain("faturado");
  });

  it("não faturado que não chegou: só a frase do pedido", () => {
    expect(
      frasesDeDivergencia([l({ status: "NAO_FATURADO", qtdFaturada: 0 })], { temNota: true }),
    ).toEqual(["• Heineken LN 330: pedimos 120 e não veio na nota"]);
  });

  it("item acrescentado na doca: chegou fora da nota", () => {
    expect(
      frasesDeDivergencia(
        [l({ status: "NAO_PEDIDO", avulsa: true, qtdPedida: 0, qtdFaturada: 0, qtdRecebida: 12 })],
        { temNota: true },
      ),
    ).toEqual(["• Heineken LN 330: chegaram 12 fora da nota"]);
  });
});
