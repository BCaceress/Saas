import { describe, expect, it } from "vitest";
import {
  faltaDaConferencia,
  fatiasDeLote,
  lotesDoJson,
  margemAposEntrada,
  problemaNosLotes,
  validadeMaisCurta,
  type LinhaParaFalta,
} from "@/lib/compras/recebimento-regras";
import {
  absorverAvulsas,
  mesclarContagemAnterior,
  type AvulsaAnterior,
} from "@/lib/compras/conciliacao-regras";
import { siglaDeExibicao } from "@/lib/fiscal/unidades";

// O que a segunda rodada do recebimento acrescentou: a falta que se abate do
// título, a linha dividida em lotes (FEFO), o aviso de margem, e a contagem que
// a doca fez à mão antes de o XML chegar. Tudo em unidade base.

const daNota = (over: Partial<LinhaParaFalta> = {}): LinhaParaFalta => ({
  qtdPedida: 24,
  qtdFaturada: 24,
  qtdRecebida: null,
  status: "OK",
  custoFaturado: 5,
  custoPedido: 5,
  bonificacao: false,
  inboundItemId: "item-1",
  ...over,
});

describe("faltaDaConferencia — o que a nota cobra e não entrou", () => {
  it("linha contada a menos vale a diferença pelo custo de entrada", () => {
    expect(faltaDaConferencia([daNota({ qtdRecebida: 20 })])).toEqual({ valor: 20, itens: 1 });
  });

  it("linha não contada entra pelo esperado — não falta nada", () => {
    expect(faltaDaConferencia([daNota()])).toEqual({ valor: 0, itens: 0 });
  });

  it("o que veio A MAIS não vira crédito: o fornecedor não cobrou", () => {
    expect(faltaDaConferencia([daNota({ qtdRecebida: 30 })])).toEqual({ valor: 0, itens: 0 });
  });

  it("bonificação e linha fora da nota não entram na conta", () => {
    expect(
      faltaDaConferencia([
        daNota({ qtdRecebida: 0, bonificacao: true }),
        daNota({ qtdRecebida: 0, inboundItemId: null }),
      ]),
    ).toEqual({ valor: 0, itens: 0 });
  });

  it("soma várias linhas e arredonda em centavos", () => {
    expect(
      faltaDaConferencia([
        daNota({ qtdRecebida: 23, custoFaturado: 3.333 }),
        daNota({ qtdRecebida: 22, custoFaturado: "1.10" }),
      ]),
    ).toEqual({ valor: 5.53, itens: 2 });
  });
});

describe("problemaNosLotes", () => {
  const lote = (quantidade: number, lote: string | null = "L1", validade: string | null = null) => ({
    lote,
    validade,
    quantidade,
  });

  it("divisão válida passa", () => {
    expect(problemaNosLotes([lote(12), lote(12, "L2", "2026-12-01")], 24)).toBeNull();
  });

  it("os lotes podem cobrir só parte — o resto entra sem lote", () => {
    expect(problemaNosLotes([lote(10)], 24)).toBeNull();
  });

  it("passar do que entra pela linha inventaria mercadoria", () => {
    expect(problemaNosLotes([lote(20), lote(10, "L2")], 24)).toMatch(/somam 30.*entram 24/);
  });

  it("quantidade é peça inteira, maior que zero", () => {
    expect(problemaNosLotes([lote(1.5)], 24)).toMatch(/Lote 1/);
    expect(problemaNosLotes([lote(0)], 24)).toMatch(/Lote 1/);
  });

  it("lote sem nome nem validade é só o resto com outro nome", () => {
    expect(problemaNosLotes([lote(5, "  ", null)], 24)).toMatch(/informe o lote ou a validade/);
  });

  it("validade fora do formato é recusada", () => {
    expect(problemaNosLotes([lote(5, "L1", "01/12/2026")], 24)).toMatch(/formato/);
  });
});

describe("fatiasDeLote — como a linha entra no estoque", () => {
  const unico = { lote: "UNICO", validade: "2026-11-30" };

  it("sem divisão, uma fatia com o lote dos campos simples", () => {
    expect(fatiasDeLote(24, null, unico)).toEqual([{ ...unico, quantidade: 24 }]);
  });

  it("lotes + o resto sem lote", () => {
    expect(
      fatiasDeLote(
        24,
        [
          { lote: "A", validade: "2026-11-01", quantidade: 12 },
          { lote: "B", validade: "2026-12-01", quantidade: 6 },
        ],
        unico,
      ),
    ).toEqual([
      { lote: "A", validade: "2026-11-01", quantidade: 12 },
      { lote: "B", validade: "2026-12-01", quantidade: 6 },
      { lote: null, validade: null, quantidade: 6 },
    ]);
  });

  it("contagem que encolheu depois da divisão corta o último lote, não inventa", () => {
    expect(
      fatiasDeLote(
        15,
        [
          { lote: "A", validade: null, quantidade: 12 },
          { lote: "B", validade: null, quantidade: 12 },
        ],
        unico,
      ),
    ).toEqual([
      { lote: "A", validade: null, quantidade: 12 },
      { lote: "B", validade: null, quantidade: 3 },
    ]);
  });

  it("nada entrando, nada a fatiar", () => {
    expect(fatiasDeLote(0, [{ lote: "A", validade: null, quantidade: 5 }], unico)).toEqual([]);
  });
});

describe("lotesDoJson", () => {
  it("lê o que foi gravado e limpa espaços", () => {
    expect(lotesDoJson([{ lote: " A ", validade: "2026-11-01T00:00:00Z", quantidade: "6" }])).toEqual([
      { lote: "A", validade: "2026-11-01", quantidade: 6 },
    ]);
  });

  it("lixo, lista vazia e quantidade zero viram 'sem lotes'", () => {
    expect(lotesDoJson(null)).toBeNull();
    expect(lotesDoJson("x")).toBeNull();
    expect(lotesDoJson([])).toBeNull();
    expect(lotesDoJson([{ lote: "A", quantidade: 0 }])).toBeNull();
  });
});

describe("validadeMaisCurta", () => {
  it("sem lotes, a validade da linha", () => {
    expect(validadeMaisCurta("2026-12-01", null)).toBe("2026-12-01");
  });

  it("com lotes, a do lote que vence primeiro", () => {
    expect(
      validadeMaisCurta("2027-01-01", [
        { lote: "A", validade: "2026-12-10", quantidade: 1 },
        { lote: "B", validade: "2026-11-05", quantidade: 1 },
        { lote: "C", validade: null, quantidade: 1 },
      ]),
    ).toBe("2026-11-05");
  });

  it("lotes sem validade não herdam a dos campos simples", () => {
    expect(validadeMaisCurta("2026-12-01", [{ lote: "A", validade: null, quantidade: 3 }])).toBeNull();
  });
});

describe("margemAposEntrada", () => {
  it("custo acima do preço é margem negativa", () => {
    expect(margemAposEntrada(10, 12)).toEqual({ pct: -20, nivel: "NEGATIVA" });
  });

  it("abaixo de 15% é margem baixa", () => {
    expect(margemAposEntrada(10, 9)).toEqual({ pct: 10, nivel: "BAIXA" });
  });

  it("margem saudável não avisa", () => {
    expect(margemAposEntrada(10, 5)).toBeNull();
  });

  it("sem preço de venda ou sem custo, não há o que comparar", () => {
    expect(margemAposEntrada(null, 5)).toBeNull();
    expect(margemAposEntrada(0, 5)).toBeNull();
    expect(margemAposEntrada(10, 0)).toBeNull();
  });
});

describe("siglaDeExibicao", () => {
  it("tira o fator colado na sigla do distribuidor", () => {
    expect(siglaDeExibicao("CX027")).toBe("CX");
    expect(siglaDeExibicao("cx24")).toBe("CX");
  });

  it("vazia vira a unidade do estoque; desconhecida fica como veio", () => {
    expect(siglaDeExibicao("")).toBe("UN");
    expect(siglaDeExibicao("ZZQ")).toBe("ZZQ");
  });
});

describe("mesclarContagemAnterior — lotes e autor viajam com a contagem", () => {
  it("a linha remontada herda lotes, quem contou e quando", () => {
    const quando = new Date("2026-10-15T14:00:00Z");
    const lotes = [{ lote: "A", validade: "2026-11-01", quantidade: 12 }];
    const [nova] = mesclarContagemAnterior(
      [{ inboundItemId: "item-1", purchaseOrderItemId: null, status: "OK" }],
      [
        {
          inboundItemId: "item-1",
          purchaseOrderItemId: null,
          status: "OK",
          qtdRecebida: 12,
          lote: null,
          validade: null,
          lotes,
          contadoPor: "user-ana",
          contadoEm: quando,
          resolucao: null,
          motivoDivergencia: null,
        },
      ],
      { decisaoSoComMesmoVeredito: true },
    );
    expect(nova).toMatchObject({ qtdRecebida: 12, lotes, contadoPor: "user-ana", contadoEm: quando });
  });
});

describe("absorverAvulsas — a nota chegou com a carga já contada", () => {
  const avulsa = (over: Partial<AvulsaAnterior> & { id: string }): AvulsaAnterior => ({
    inboundItemId: null,
    purchaseOrderItemId: null,
    productId: "heineken",
    bonificacao: false,
    status: "NAO_PEDIDO",
    qtdRecebida: 24,
    lote: "L9",
    validade: null,
    resolucao: "ACEITO",
    motivoDivergencia: "veio sem nota",
    contadoPor: "user-ana",
    ...over,
  });
  const daNotaNova = (over: Record<string, unknown> = {}) => ({
    inboundItemId: "item-1",
    productId: "heineken" as string | null,
    bonificacao: false,
    qtdRecebida: null as unknown,
    lote: null as string | null,
    ...over,
  });

  it("a contagem da avulsa passa para a linha da nota do mesmo produto, e a avulsa sai", () => {
    const { linhas, absorvidas } = absorverAvulsas([daNotaNova()], [avulsa({ id: "av-1" })]);
    expect(absorvidas).toEqual(["av-1"]);
    expect(linhas[0]).toMatchObject({ qtdRecebida: 24, lote: "L9", contadoPor: "user-ana" });
    // Decisão sobre a "divergência" da avulsa não viaja.
    expect(linhas[0]).not.toHaveProperty("motivoDivergencia");
  });

  it("linha da nota já contada não é sobrescrita", () => {
    const { linhas, absorvidas } = absorverAvulsas(
      [daNotaNova({ qtdRecebida: 10 })],
      [avulsa({ id: "av-1" })],
    );
    expect(absorvidas).toEqual([]);
    expect(linhas[0].qtdRecebida).toBe(10);
  });

  it("brinde só com brinde; outro produto, nada", () => {
    const { absorvidas } = absorverAvulsas(
      [daNotaNova({ bonificacao: true }), daNotaNova({ productId: "coca" })],
      [avulsa({ id: "av-1" })],
    );
    expect(absorvidas).toEqual([]);
  });

  it("cada avulsa vai para uma linha só — a segunda linha da nota fica sem contagem", () => {
    const { linhas, absorvidas } = absorverAvulsas(
      [daNotaNova(), daNotaNova({ inboundItemId: "item-2" })],
      [avulsa({ id: "av-1" })],
    );
    expect(absorvidas).toEqual(["av-1"]);
    expect(linhas[0].qtdRecebida).toBe(24);
    expect(linhas[1].qtdRecebida).toBeNull();
  });

  it("avulsa sem contagem ou sem produto fica onde está", () => {
    const { absorvidas } = absorverAvulsas(
      [daNotaNova()],
      [avulsa({ id: "av-1", qtdRecebida: null }), avulsa({ id: "av-2", productId: null })],
    );
    expect(absorvidas).toEqual([]);
  });
});
