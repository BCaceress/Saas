import { describe, expect, it } from "vitest";
import { resumirCotacao, type EntradaResumo } from "@/lib/compras/cotacao-resumo";

// O motor decide compra: cada regra aqui trava um número que o operador lê na
// tela. Texto pode mudar; o valor citado, não.

const itens = [
  { id: "i1", descricao: "Brahma 473ml", quantidade: 10, productId: "p1" },
  { id: "i2", descricao: "Skol 473ml", quantidade: 5, productId: "p2" },
];

function convite(
  id: string,
  nome: string,
  precos: Record<string, number | null>,
  frete: number | null = null,
): EntradaResumo["convites"][number] {
  return {
    id,
    supplierId: `s-${id}`,
    supplierNome: nome,
    status: "RESPONDIDA",
    frete,
    prazoEntregaDias: null,
    respostas: Object.entries(precos).map(([quotationItemId, preco]) => ({
      quotationItemId,
      disponivel: preco !== null,
      precoUnitario: preco ?? 0,
    })),
  };
}

const base = { itens, prazoResposta: null, referencias: {} };

describe("resumirCotacao", () => {
  it("aponta quem fecha a lista inteira mais barato e a diferença", () => {
    const r = resumirCotacao({
      ...base,
      convites: [
        convite("a", "Ambev", { i1: 10, i2: 20 }), // 10×10 + 20×5 = 200
        convite("b", "Coca", { i1: 12, i2: 22 }), // 12×10 + 22×5 = 230
      ],
    });

    expect(r.melhorFornecedor).toBe("Ambev");
    expect(r.melhorTotal).toBe(200);
    expect(r.economia).toBe(30);
    expect(r.itens.find((i) => i.id === "melhor-cesta")?.texto).toContain("Ambev");
  });

  it("não deixa cesta incompleta disputar o fornecedor único", () => {
    const r = resumirCotacao({
      ...base,
      convites: [
        convite("a", "Ambev", { i1: 10, i2: 20 }), // 200, completa
        convite("b", "Fruki", { i1: 1, i2: null }), // baratíssima, mas não cobre tudo
      ],
    });

    // A cesta pela metade não vira "melhor total" nem inventa economia.
    expect(r.melhorFornecedor).toBe("Ambev");
    expect(r.economia).toBe(0);
  });

  it("mostra o ganho de dividir o pedido quando ele existe", () => {
    const r = resumirCotacao({
      ...base,
      convites: [
        convite("a", "Ambev", { i1: 10, i2: 30 }), // 100 + 150 = 250
        convite("b", "Fruki", { i1: 14, i2: 20 }), // 140 + 100 = 240
      ],
    });

    // Melhor único = 240 (Fruki). Dividido = 10×10 + 20×5 = 200.
    const dividir = r.itens.find((i) => i.id === "dividir");
    expect(dividir).toBeDefined();
    expect(dividir?.impacto).toBe(40);
  });

  it("compara com o preço anterior do MESMO fornecedor", () => {
    const r = resumirCotacao({
      ...base,
      referencias: { "s-a:p1": 10 }, // Ambev vendia Brahma a 10
      convites: [convite("a", "Ambev", { i1: 12, i2: 20 })],
    });

    const alta = r.itens.find((i) => i.id === "alta");
    expect(alta?.texto).toContain("20%");
    expect(alta?.impacto).toBe(20); // (12 − 10) × 10 unidades
  });

  it("ignora variação de ruído (< 2%)", () => {
    const r = resumirCotacao({
      ...base,
      referencias: { "s-a:p1": 10 },
      convites: [convite("a", "Ambev", { i1: 10.1, i2: 20 })],
    });

    expect(r.itens.find((i) => i.id === "alta")).toBeUndefined();
  });

  it("avisa quando o frete vira o jogo", () => {
    const r = resumirCotacao({
      ...base,
      convites: [
        convite("a", "Ambev", { i1: 10, i2: 20 }, 100), // itens 200 + frete 100 = 300
        convite("b", "Coca", { i1: 11, i2: 21 }, 0), // itens 215 = 215
      ],
    });

    expect(r.melhorFornecedor).toBe("Coca");
    expect(r.itens.find((i) => i.id === "frete")?.texto).toContain("Ambev");
  });

  it("denuncia item que ninguém cotou", () => {
    const r = resumirCotacao({
      ...base,
      convites: [convite("a", "Ambev", { i1: 10, i2: null })],
    });

    expect(r.itens.find((i) => i.id === "sem-oferta")?.texto).toContain("Skol 473ml");
  });

  it("não fala nada sem resposta nenhuma", () => {
    const r = resumirCotacao({ ...base, convites: [] });
    expect(r.itens).toHaveLength(0);
    expect(r.melhorTotal).toBeNull();
  });
});
