import { describe, it, expect } from "vitest";
import type { Acesso } from "@/lib/permissoes";
import { agregar, prepararConsulta, ConsultaInvalidaError } from "@/lib/analises/motor";
import { consultaSchema, type Consulta } from "@/lib/analises/schema";
import type { LinhaFato } from "@/lib/analises/fatos/tipos";

// A matemática do motor. O erro perigoso aqui não é a tela feia — é o número
// plausível: um ticket médio que é a média dos tickets, um total de vendas que
// conta a mesma venda uma vez por produto, uma margem que aparece para quem não
// pode ver custo. Todos passam despercebidos na tela e viram decisão de compra.

const admin: Acesso[] = [{ perfil: "ADMINISTRADOR", siteId: null }];
const caixa: Acesso[] = [{ perfil: "CAIXA", siteId: null }];
const contador: Acesso[] = [{ perfil: "CONTADOR", siteId: null }];

function consulta(parcial: Partial<Consulta> & Pick<Consulta, "metricas">): Consulta {
  return consultaSchema.parse({ fato: "venda-item", ...parcial });
}

/** Um item de venda no grão do fato. */
function item(
  produto: string,
  venda: string,
  vals: { receita: number; quantidade?: number; cmv?: number },
): LinhaFato {
  return {
    dims: { produto },
    vals: { quantidade: 1, cmv: 0, desconto: 0, ...vals },
    chaves: { venda },
  };
}

function rodar(c: Consulta, linhas: LinhaFato[], acessos: Acesso[] = admin) {
  return agregar({ preparada: prepararConsulta(c, acessos), linhas });
}

describe("agregação por dimensão", () => {
  it("soma as linhas do mesmo grupo e ordena pela primeira métrica", () => {
    const r = rodar(consulta({ dimensoes: ["produto"], metricas: ["receita"] }), [
      item("Cerveja", "v1", { receita: 10 }),
      item("Cerveja", "v2", { receita: 5 }),
      item("Água", "v3", { receita: 20 }),
    ]);

    expect(r.brutas).toEqual([
      { produto: "Água", receita: 20 },
      { produto: "Cerveja", receita: 15 },
    ]);
    expect(r.totais.receita).toBe(35);
  });

  it("sem dimensão devolve uma linha só — o total do período", () => {
    const r = rodar(consulta({ dimensoes: [], metricas: ["receita"] }), [
      item("Cerveja", "v1", { receita: 10 }),
      item("Água", "v2", { receita: 20 }),
    ]);

    expect(r.linhas).toHaveLength(1);
    expect(r.totais.receita).toBe(30);
  });

  it("linha sem valor na dimensão vira um grupo próprio, não some", () => {
    const r = rodar(consulta({ dimensoes: ["categoria"], metricas: ["receita"] }), [
      { dims: { categoria: null }, vals: { receita: 7 }, chaves: { venda: "v1" } },
      { dims: { categoria: "Bebidas" }, vals: { receita: 3 }, chaves: { venda: "v2" } },
    ]);

    expect(r.totais.receita).toBe(10);
    expect(r.linhas.map((l) => l[0])).toContain("—");
  });
});

describe("métricas derivadas", () => {
  it("ticket médio é receita ÷ vendas do grupo, não a média dos tickets", () => {
    // Duas vendas: uma de 100 (um item) e outra de 20 (dois itens de 10).
    const r = rodar(consulta({ dimensoes: [], metricas: ["ticket", "receita", "numVendas"] }), [
      item("A", "v1", { receita: 100 }),
      item("B", "v2", { receita: 10 }),
      item("C", "v2", { receita: 10 }),
    ]);

    expect(r.totais.numVendas).toBe(2);
    expect(r.totais.receita).toBe(120);
    expect(r.totais.ticket).toBe(60);
  });

  it("margem % sai dos totais do grupo, não da média das linhas", () => {
    const r = rodar(consulta({ dimensoes: [], metricas: ["margemPct"] }), [
      item("A", "v1", { receita: 100, cmv: 90 }), // 10%
      item("B", "v2", { receita: 100, cmv: 10 }), // 90%
    ]);

    // (200 - 100) / 200 = 50%. A média simples também daria 50 — o caso que
    // separa os dois é o de pesos diferentes:
    expect(r.totais.margemPct).toBe(50);

    const desigual = rodar(consulta({ dimensoes: [], metricas: ["margemPct"] }), [
      item("A", "v1", { receita: 1000, cmv: 900 }), // 10%
      item("B", "v2", { receita: 10, cmv: 1 }), // 90%
    ]);
    // Ponderado: (1010 - 901) / 1010 ≈ 10,79% — e não 50%.
    expect(desigual.totais.margemPct).toBeCloseTo(10.79, 1);
  });

  it("divisão por zero vira zero, não NaN nem Infinity", () => {
    const r = rodar(consulta({ dimensoes: [], metricas: ["ticket", "margemPct"] }), []);
    expect(r.totais.ticket).toBe(0);
    expect(r.totais.margemPct).toBe(0);
  });
});

describe("contagem distinta", () => {
  it("a mesma venda em dois produtos conta uma vez no total", () => {
    const r = rodar(consulta({ dimensoes: ["produto"], metricas: ["numVendas"] }), [
      item("Cerveja", "v1", { receita: 10 }),
      item("Amendoim", "v1", { receita: 5 }),
      item("Cerveja", "v2", { receita: 10 }),
    ]);

    // Por produto: cerveja em 2 vendas, amendoim em 1. Somadas dariam 3 — mas
    // vendas distintas no período são 2.
    expect(r.brutas).toEqual([
      { produto: "Cerveja", numVendas: 2 },
      { produto: "Amendoim", numVendas: 1 },
    ]);
    expect(r.totais.numVendas).toBe(2);
  });
});

describe("filtros", () => {
  it("filtra por dimensão sem acento e sem caixa", () => {
    const r = rodar(
      consulta({
        dimensoes: ["produto"],
        metricas: ["receita"],
        filtros: [{ campo: "produto", op: "contem", valor: "AGUA" }],
      }),
      [item("Água com gás", "v1", { receita: 5 }), item("Cerveja", "v2", { receita: 9 })],
    );

    expect(r.totais.receita).toBe(5);
  });

  it("filtro por métrica age depois da soma do grupo", () => {
    const r = rodar(
      consulta({
        dimensoes: ["produto"],
        metricas: ["receita"],
        filtros: [{ campo: "receita", op: ">=", valor: 10 }],
      }),
      [
        // Sozinhas nenhuma chega a 10; somadas, o grupo passa.
        item("Cerveja", "v1", { receita: 6 }),
        item("Cerveja", "v2", { receita: 6 }),
        item("Água", "v3", { receita: 9 }),
      ],
    );

    expect(r.brutas).toEqual([{ produto: "Cerveja", receita: 12 }]);
  });
});

describe("permissão", () => {
  it("corta métrica financeira de quem não tem relatorio.financeiro", () => {
    const r = rodar(
      consulta({ dimensoes: ["produto"], metricas: ["receita", "margem"] }),
      [item("Cerveja", "v1", { receita: 10, cmv: 4 })],
      contador,
    );

    expect(r.consulta.metricas).toEqual(["receita"]);
    expect(r.metricasRemovidas).toContain("Margem");
    expect(r.colunas.map((c) => c.id)).not.toContain("margem");
  });

  it("corta também o FILTRO por métrica financeira", () => {
    // Sem isso, quem não pode ver margem descobre o valor por tentativa e erro.
    const r = rodar(
      consulta({
        dimensoes: ["produto"],
        metricas: ["receita"],
        filtros: [{ campo: "margemPct", op: "<=", valor: 5 }],
      }),
      [item("Cerveja", "v1", { receita: 10, cmv: 9.9 })],
      contador,
    );

    expect(r.consulta.filtros).toHaveLength(0);
    expect(r.filtrosRemovidos).toContain("Margem %");
    expect(r.totais.receita).toBe(10);
  });

  it("mantém a métrica financeira para quem tem a permissão", () => {
    const r = rodar(
      consulta({ dimensoes: [], metricas: ["margem"] }),
      [item("Cerveja", "v1", { receita: 10, cmv: 4 })],
      admin,
    );

    expect(r.metricasRemovidas).toHaveLength(0);
    expect(r.totais.margem).toBe(6);
  });

  it("consulta que só pedia métrica bloqueada cai no padrão do fato", () => {
    // Melhor mostrar o que a pessoa PODE ver do que uma tela de erro: quem
    // barra o acesso à tela é o guard da rota, não o motor.
    const r = rodar(
      consulta({ dimensoes: ["produto"], metricas: ["margem"] }),
      [item("Cerveja", "v1", { receita: 10, cmv: 4 })],
      caixa,
    );

    expect(r.consulta.metricas).toEqual(["receita", "quantidade"]);
    expect(r.metricasRemovidas).toContain("Margem");
  });

  it("recusa quando o fato não existe", () => {
    expect(() =>
      prepararConsulta({ ...consulta({ metricas: ["receita"] }), fato: "caixa" }, admin),
    ).toThrow(ConsultaInvalidaError);
  });
});

describe("nomes inválidos", () => {
  it("descarta dimensão inventada em vez de derrubar a consulta", () => {
    const r = rodar(
      consulta({ dimensoes: ["produto", "inventada"], metricas: ["receita"] }),
      [item("Cerveja", "v1", { receita: 10 })],
    );

    expect(r.consulta.dimensoes).toEqual(["produto"]);
    expect(r.totais.receita).toBe(10);
  });
});

describe("ordenação e limite", () => {
  it("respeita ordenar ascendente e informa o total de grupos", () => {
    const r = rodar(
      consulta({
        dimensoes: ["produto"],
        metricas: ["receita"],
        ordenar: { por: "receita", ordem: "asc" },
        limite: 2,
      }),
      [
        item("A", "v1", { receita: 30 }),
        item("B", "v2", { receita: 10 }),
        item("C", "v3", { receita: 20 }),
      ],
    );

    expect(r.brutas.map((l) => l.produto)).toEqual(["B", "C"]);
    expect(r.totalGrupos).toBe(3);
    // O total é do período inteiro, não da janela mostrada.
    expect(r.totais.receita).toBe(60);
  });

  it("série no tempo sai em ordem cronológica, não do maior para o menor", () => {
    const linhas: LinhaFato[] = [
      { dims: { tempo: "2026-07-03" }, vals: { receita: 5 }, chaves: { venda: "v3" } },
      { dims: { tempo: "2026-07-01" }, vals: { receita: 50 }, chaves: { venda: "v1" } },
      { dims: { tempo: "2026-07-02" }, vals: { receita: 20 }, chaves: { venda: "v2" } },
    ];
    const r = rodar(
      consulta({ dimensoes: ["tempo"], metricas: ["receita"], granularidade: "dia" }),
      linhas,
    );

    expect(r.linhas.map((l) => l[0])).toEqual(["01/07/26", "02/07/26", "03/07/26"]);
  });
});

describe("comparação com o período anterior", () => {
  it("casa os grupos e devolve a variação por linha", () => {
    const preparada = prepararConsulta(
      consulta({ dimensoes: ["produto"], metricas: ["receita"], comparar: true }),
      admin,
    );
    const r = agregar({
      preparada,
      linhas: [item("Cerveja", "v1", { receita: 150 })],
      anteriores: [item("Cerveja", "v0", { receita: 100 })],
    });

    expect(r.variacoes?.[0]?.[0]).toBe(50);
  });
});
