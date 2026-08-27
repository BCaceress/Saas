import { describe, it, expect } from "vitest";
import {
  fatorDaUnidade,
  frasesDeConversao,
  rotuloDaUnidade,
  unidadeComercial,
  unidadeContinua,
  unidadesDaLinha,
  unidadesParaEstoque,
} from "@/lib/fiscal/unidades";
import { inferirVinculo, origemDoFator } from "@/lib/fiscal/vinculo";
import { divergenciasDoItem } from "@/lib/fiscal/divergencias";

/**
 * O caso que motivou o catálogo: nota de tabacaria com "0,6 MI".
 *
 * Milheiro é mil maços. Sem esta regra a linha entrava no estoque como 0,6 —
 * e o buraco só apareceria no inventário, meses depois.
 */
describe("unidades comerciais", () => {
  it("sabe o que a sigla vale quando ela vale sozinha", () => {
    expect(fatorDaUnidade("MI")).toBe(1000);
    expect(fatorDaUnidade("mi")).toBe(1000);
    expect(fatorDaUnidade("MILHEIRO")).toBe(1000);
    expect(fatorDaUnidade("DZ")).toBe(12);
    expect(fatorDaUnidade("CENTO")).toBe(100);
    expect(fatorDaUnidade("UN")).toBe(1);
  });

  it("não inventa conversão para o que depende do produto", () => {
    // Caixa de long neck tem 12; caixa de suco tem 6. Só o cadastro responde.
    expect(fatorDaUnidade("CX")).toBeNull();
    expect(fatorDaUnidade("FD")).toBeNull();
    expect(fatorDaUnidade("DP")).toBeNull();
    // Peso e volume não viram peça: 8,4 kg não são 8 garrafas.
    expect(fatorDaUnidade("KG")).toBeNull();
    expect(fatorDaUnidade("L")).toBeNull();
    // Sigla que ninguém conhece continua sem resposta — a tela pergunta.
    expect(fatorDaUnidade("XYZ")).toBeNull();
  });

  it("mede peso e volume na própria grandeza", () => {
    expect(unidadeComercial("G")).toMatchObject({ base: "KG", fator: 0.001 });
    expect(unidadeComercial("ML")).toMatchObject({ base: "L", fator: 0.001 });
    expect(unidadeContinua("KG")).toBe(true);
    expect(unidadeContinua("MI")).toBe(false);
  });

  it("entende a sigla colada no fator", () => {
    expect(unidadeComercial("CX24")?.sigla).toBe("CX");
    expect(unidadeComercial("  fd12 ")?.sigla).toBe("FD");
  });

  it("escreve a unidade de um jeito que não engana", () => {
    expect(rotuloDaUnidade("MI")).toBe("Milheiro");
    expect(rotuloDaUnidade("MILHEIRO")).toBe("MILHEIRO (milheiro)");
    expect(frasesDeConversao("MI", 1000)).toBe("1 MI = 1.000 UN");
  });
});

describe("0,6 MI de cigarro", () => {
  const item = {
    gtin: null,
    unidade: "MI",
    quantidade: 0.6,
    unidadeTributavel: null,
    quantidadeTributavel: null,
  };

  it("vira 600 unidades no estoque, não 0,6", () => {
    const v = inferirVinculo({ ean: null, packagings: [] }, item);
    expect(v.fatorConversao).toBe(1000);
    expect(item.quantidade * v.fatorConversao).toBe(600);
  });

  it("diz que o número veio da unidade, não de um chute", () => {
    expect(origemDoFator({ ...item, packagingId: null, fatorConversao: 1000 })).toBe("UNIDADE");
  });

  it("não interrompe o operador pedindo conversão que já existe", () => {
    const ds = divergenciasDoItem(
      { ...item, ncm: null, fatorConversao: 1000, packagingId: null, bonificacao: false, custoLinha: 0 },
      { id: "p1", nome: "Cigarro X", ean: null, ncm: null, custoMedio: 0, packagings: [] },
    );
    expect(ds.map((d) => d.tipo)).not.toContain("FATOR_CHUTADO");
  });

  it("interrompe quando a sigla não responde sozinha", () => {
    const ds = divergenciasDoItem(
      {
        ...item,
        unidade: "CX",
        quantidade: 3,
        ncm: null,
        fatorConversao: 1,
        packagingId: null,
        bonificacao: false,
        custoLinha: 0,
      },
      { id: "p1", nome: "Suco", ean: null, ncm: null, custoMedio: 0, packagings: [] },
    );
    const chute = ds.find((d) => d.tipo === "FATOR_CHUTADO");
    expect(chute?.titulo).toBe("Conversão necessária");
    expect(chute?.precisaConfirmar).toBe(true);
  });

  it("a nota assinada ganha da tabela quando as duas falam", () => {
    // uCom DZ (12 por definição), mas a nota declara 10 por caixa fechada.
    const v = inferirVinculo(
      { ean: null, packagings: [] },
      { gtin: null, unidade: "DZ", quantidade: 2, unidadeTributavel: "UN", quantidadeTributavel: 20 },
    );
    expect(v.fatorConversao).toBe(10);
  });
});

/**
 * Unidade é peça. O saldo nunca guarda 1,5 garrafa — nem arredondando em
 * silêncio para 2, que seria inventar mercadoria que ninguém recebeu.
 */
describe("unidade não aceita fração", () => {
  it("aceita o inteiro que a conversão produz, apesar do ruído binário", () => {
    // 0,6 × 1000 dá 600.0000000000001 em ponto flutuante.
    expect(unidadesDaLinha(0.6, 1000)).toMatchObject({ unidades: 600, exata: true });
    expect(unidadesDaLinha(2.5, 12)).toMatchObject({ unidades: 30, exata: true });
    expect(unidadesParaEstoque(0.6, 1000)).toBe(600);
  });

  it("recusa a conversão que não fecha em peça", () => {
    expect(unidadesDaLinha(0.5, 3).exata).toBe(false);
    expect(() => unidadesParaEstoque(0.5, 3)).toThrow(/unidades inteiras/);
    expect(() => unidadesParaEstoque(1.2, 1)).toThrow(/peças/);
  });

  it("a mensagem mostra a conta que não fechou", () => {
    expect(() => unidadesParaEstoque(0.5, 3, "Item ABC")).toThrow(/0,5 × 3 = 1,5/);
  });

  it("a régua de divergências trava a nota com conversão fracionada", () => {
    const ds = divergenciasDoItem(
      {
        gtin: null,
        ncm: null,
        unidade: "CX",
        quantidade: 0.5,
        unidadeTributavel: null,
        quantidadeTributavel: null,
        fatorConversao: 3,
        packagingId: null,
        bonificacao: false,
        custoLinha: 0,
      },
      { id: "p1", nome: "Suco", ean: null, ncm: null, custoMedio: 0, packagings: [] },
    );
    const d = ds.find((x) => x.tipo === "CONVERSAO_FRACIONADA");
    expect(d?.severidade).toBe("CRITICA");
    expect(d?.precisaConfirmar).toBe(true);
  });
});
