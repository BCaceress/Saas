import { describe, expect, it } from "vitest";
import { atencaoDoItem, type EntradaAtencao } from "@/lib/compras/atencao-item";

const base: EntradaAtencao = {
  valores: [40, 45],
  respondidos: 2,
  melhorParcial: false,
  marcasDivergem: false,
  temPromocao: false,
};

describe("atencaoDoItem", () => {
  it("vencedor claro não pede atenção", () => {
    expect(atencaoDoItem(base)).toBeNull();
  });

  it("sem respostas ainda, nada a decidir", () => {
    expect(atencaoDoItem({ ...base, valores: [], respondidos: 0 })).toBeNull();
  });

  it("ninguém cotou", () => {
    expect(atencaoDoItem({ ...base, valores: [] })?.tipo).toBe("ninguem");
  });

  it("proposta única só pede atenção quando mais de um respondeu", () => {
    expect(atencaoDoItem({ ...base, valores: [40] })?.tipo).toBe("unica");
    expect(atencaoDoItem({ ...base, valores: [40], respondidos: 1 })).toBeNull();
  });

  it("empate abaixo de 2% entre as duas melhores", () => {
    const r = atencaoDoItem({ ...base, valores: [40, 40.6, 60] });
    expect(r?.tipo).toBe("empate");
    expect(r?.texto).toBe("empate: diferença de 1,5%");
    expect(atencaoDoItem({ ...base, valores: [40, 40] })?.texto).toBe("empate: mesmo preço");
    // 2% em diante já é vencedor.
    expect(atencaoDoItem({ ...base, valores: [40, 40.8] })).toBeNull();
  });

  it("ordem de gravidade: empate antes de marca e promoção", () => {
    const r = atencaoDoItem({
      ...base,
      valores: [40, 40.1],
      marcasDivergem: true,
      temPromocao: true,
    });
    expect(r?.tipo).toBe("empate");
  });

  it("parcial, marca e promoção", () => {
    expect(atencaoDoItem({ ...base, melhorParcial: true })?.tipo).toBe("parcial");
    expect(atencaoDoItem({ ...base, marcasDivergem: true })?.tipo).toBe("marca");
    expect(atencaoDoItem({ ...base, temPromocao: true })?.tipo).toBe("promocao");
  });
});
