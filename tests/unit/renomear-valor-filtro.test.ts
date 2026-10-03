import { describe, it, expect, vi } from "vitest";

// O módulo é `server-only` e importa `db` — nada disso roda aqui, e as funções
// testadas são puras.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ db: {} }));

const { trocarValor, trocarNaConfig, trocarNaConsulta } = await import(
  "@/lib/relatorios/renomear-valor-filtro"
);

// ============================================================
// Renomear categoria não pode estragar relatório salvo — e também não pode
// estragar o RESTO da configuração ao consertar um campo.
// ============================================================

describe("trocarValor", () => {
  it("troca escalar e item de lista", () => {
    expect(trocarValor("Bebidas", "Bebidas", "Bebidas e água")).toBe("Bebidas e água");
    expect(trocarValor(["Limpeza", "Bebidas"], "Bebidas", "Bebidas e água")).toEqual([
      "Limpeza",
      "Bebidas e água",
    ]);
  });

  it("devolve null quando não casa — é o que impede regravar à toa", () => {
    expect(trocarValor("Limpeza", "Bebidas", "X")).toBeNull();
    expect(trocarValor(["Limpeza"], "Bebidas", "X")).toBeNull();
    expect(trocarValor(undefined, "Bebidas", "X")).toBeNull();
    expect(trocarValor(42, "Bebidas", "X")).toBeNull();
  });

  it("casa só o nome EXATO — não mexe em quem só contém o texto", () => {
    expect(trocarValor("Bebidas quentes", "Bebidas", "X")).toBeNull();
  });
});

describe("trocarNaConfig", () => {
  const config = {
    filtros: { categoria: ["Bebidas", "Limpeza"], marca: "Heineken" },
    periodo: { preset: "30d" },
    colunas: ["nome", "total"],
    limite: 1000,
  };

  it("troca só o campo pedido e devolve o resto intacto", () => {
    const novo = trocarNaConfig(config, "categoria", "Bebidas", "Bebidas e água");
    expect(novo).toEqual({
      ...config,
      filtros: { categoria: ["Bebidas e água", "Limpeza"], marca: "Heineken" },
    });
  });

  it("não confunde campos: o mesmo nome em 'marca' fica quieto", () => {
    expect(trocarNaConfig(config, "categoria", "Heineken", "X")).toBeNull();
  });

  it("config sem o valor, malformada ou vazia não é tocada", () => {
    expect(trocarNaConfig(config, "categoria", "Doces", "X")).toBeNull();
    expect(trocarNaConfig({ filtros: [] }, "categoria", "Bebidas", "X")).toBeNull();
    expect(trocarNaConfig(null, "categoria", "Bebidas", "X")).toBeNull();
    expect(trocarNaConfig("texto", "categoria", "Bebidas", "X")).toBeNull();
  });
});

describe("trocarNaConsulta", () => {
  const consulta = {
    fato: "vendas",
    metricas: ["receita"],
    filtros: [
      { campo: "categoria", op: "em", valor: ["Bebidas"] },
      { campo: "loja", op: "=", valor: "Matriz" },
    ],
    limite: 20,
  };

  it("troca dentro da lista de filtros, preservando ordem e vizinhos", () => {
    const novo = trocarNaConsulta(consulta, "categoria", "Bebidas", "Bebidas e água");
    expect(novo).toEqual({
      ...consulta,
      filtros: [
        { campo: "categoria", op: "em", valor: ["Bebidas e água"] },
        { campo: "loja", op: "=", valor: "Matriz" },
      ],
    });
  });

  it("filtros ausentes, não-lista ou sem o valor não são tocados", () => {
    expect(trocarNaConsulta(consulta, "categoria", "Doces", "X")).toBeNull();
    expect(trocarNaConsulta({ fato: "vendas" }, "categoria", "Bebidas", "X")).toBeNull();
    expect(
      trocarNaConsulta({ filtros: { categoria: "Bebidas" } }, "categoria", "Bebidas", "X"),
    ).toBeNull();
  });
});
