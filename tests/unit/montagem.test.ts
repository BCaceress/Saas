import { describe, it, expect } from "vitest";
import {
  montarCamadas,
  volumeDasCamadas,
  vaosDasCamadas,
} from "@/lib/montagem";

/**
 * A montagem é o que o operador VÊ no PDV: cada escolha vira camada no copo
 * (receita) ou vão na caixa (kit). Se a escala do tamanho não bater aqui, o
 * copo desenhado mente sobre o que a baixa de estoque vai consumir.
 */

const fixos = [
  { componentProductId: "gelo", nome: "Gelo", quantidade: 70, unidade: "ML" },
];

const grupos = [
  {
    id: "g-vodka",
    items: [
      { componentProductId: "abs", nome: "Absolut", quantidade: 50, unidade: "ML" },
      { componentProductId: "smi", nome: "Smirnoff", quantidade: 50, unidade: "ML" },
    ],
  },
  {
    id: "g-mix",
    items: [
      { componentProductId: "ene", nome: "Energético", quantidade: 150, unidade: "ML" },
      { componentProductId: "rod", nome: "Rodela de limão", quantidade: 1, unidade: "UN" },
    ],
  },
];

describe("montarCamadas", () => {
  it("junta itens fixos e só as opções escolhidas", () => {
    const camadas = montarCamadas(fixos, grupos, {
      "g-vodka": ["abs"],
      "g-mix": ["ene"],
    });
    expect(camadas.map((c) => c.componentProductId)).toEqual(["gelo", "abs", "ene"]);
    expect(camadas.find((c) => c.componentProductId === "smi")).toBeUndefined();
  });

  it("marca o que é fixo e o que foi escolha do cliente", () => {
    const camadas = montarCamadas(fixos, grupos, { "g-vodka": ["smi"] });
    expect(camadas.find((c) => c.componentProductId === "gelo")?.fixo).toBe(true);
    expect(camadas.find((c) => c.componentProductId === "smi")?.fixo).toBe(false);
  });

  it("mantém a ordem dos grupos nas escolhas", () => {
    const camadas = montarCamadas([], grupos, {
      "g-mix": ["ene"],
      "g-vodka": ["abs"],
    });
    expect(camadas.map((c) => c.componentProductId)).toEqual(["abs", "ene"]);
  });

  it("escala fixos e escolhas pelo fator do tamanho", () => {
    const camadas = montarCamadas(fixos, grupos, { "g-vodka": ["abs"] }, 2);
    expect(camadas.map((c) => c.quantidade)).toEqual([140, 100]);
  });

  it("fator inválido não some com a ficha", () => {
    for (const fator of [0, -1]) {
      const camadas = montarCamadas(fixos, grupos, { "g-vodka": ["abs"] }, fator);
      expect(camadas.map((c) => c.quantidade)).toEqual([70, 50]);
    }
  });

  it("grupo sem seleção não entra", () => {
    const camadas = montarCamadas([], grupos, {});
    expect(camadas).toEqual([]);
  });
});

describe("volumeDasCamadas", () => {
  it("soma só o que é dose — guarnição não ocupa volume", () => {
    const camadas = montarCamadas(fixos, grupos, {
      "g-vodka": ["abs"],
      "g-mix": ["ene", "rod"],
    });
    expect(volumeDasCamadas(camadas)).toBe(270);
  });

  it("acompanha o tamanho escolhido", () => {
    const camadas = montarCamadas(fixos, grupos, { "g-vodka": ["abs"] }, 1.5);
    expect(volumeDasCamadas(camadas)).toBe(180);
  });
});

describe("vaosDasCamadas", () => {
  it("cada unidade ocupa um vão da caixa", () => {
    const kitFixos = [
      { componentProductId: "copo", nome: "Copos", quantidade: 1, unidade: "UN" },
    ];
    const kitGrupos = [
      {
        id: "g-vodka",
        items: [{ componentProductId: "abs", nome: "Absolut 1 L", quantidade: 1, unidade: "UN" }],
      },
      {
        id: "g-lata",
        items: [{ componentProductId: "rb", nome: "Red Bull", quantidade: 4, unidade: "UN" }],
      },
    ];
    const camadas = montarCamadas(kitFixos, kitGrupos, {
      "g-vodka": ["abs"],
      "g-lata": ["rb"],
    });
    expect(vaosDasCamadas(camadas)).toBe(6);
  });

  it("tamanho maior ocupa mais vãos", () => {
    const kitGrupos = [
      {
        id: "g-lata",
        items: [{ componentProductId: "rb", nome: "Red Bull", quantidade: 2, unidade: "UN" }],
      },
    ];
    const camadas = montarCamadas([], kitGrupos, { "g-lata": ["rb"] }, 3);
    expect(vaosDasCamadas(camadas)).toBe(6);
  });
});
