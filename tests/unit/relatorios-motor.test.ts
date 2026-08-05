import { describe, expect, it } from "vitest";
import {
  codificarConfig,
  configPadrao,
  decodificarConfig,
  descreverConfig,
  normalizarConfig,
} from "@/lib/relatorios/config";
import { medirColunas, planejarPdf } from "@/lib/relatorios/layout-pdf";
import { executarRelatorio } from "@/lib/relatorios/executar";
import type { Linha, ReportDefinition } from "@/lib/relatorios/definicao";
import { POLICY_PADRAO } from "@/lib/estoque-estrategia";
import type { Acesso } from "@/lib/permissoes";

/**
 * O motor genérico é o único caminho de geração de relatório do sistema — se
 * ele erra, erram os quarenta relatórios de uma vez. Estes testes fecham o
 * contrato em três frentes:
 *
 *  · **config** — o que o operador pediu sobrevive ao tempo (modelo salvo em
 *    janeiro não pode quebrar quando uma coluna sai da definição);
 *  · **motor** — filtrar, ordenar, agrupar, totalizar e cortar por permissão;
 *  · **layout** — a folha decide sozinha orientação, escala e quebra.
 *
 * Tudo puro: nenhuma ida ao banco, a fonte é um array literal.
 */

const ADMIN: Acesso[] = [{ perfil: "ADMINISTRADOR", siteId: null }];
const CAIXA: Acesso[] = [{ perfil: "CAIXA", siteId: null }];

const LINHAS: Linha[] = [
  { produto: "Cerveja Pilsen 350ml", categoria: "Cervejas", qtd: 120, valor: 480, ativo: true },
  { produto: "Cerveja IPA 355ml", categoria: "Cervejas", qtd: 30, valor: 300, ativo: true },
  { produto: "Água com gás 500ml", categoria: "Águas", qtd: 0, valor: 0, ativo: false },
  { produto: "Refrigerante cola 2L", categoria: "Refrigerantes", qtd: 45, valor: 360, ativo: true },
];

function definicao(over: Partial<ReportDefinition> = {}): ReportDefinition {
  return {
    id: "teste",
    nome: "Teste",
    descricao: "Relatório de teste.",
    categoria: "estoque",
    icon: "Boxes",
    permissao: "relatorio.ver",
    filtros: [
      { id: "produto", label: "Produto", tipo: "texto", coluna: "produto" },
      {
        id: "categoria",
        label: "Categoria",
        tipo: "opcoes",
        coluna: "categoria",
        multiplo: true,
      },
      { id: "qtdMin", label: "Quantidade mínima", tipo: "numero", coluna: "qtd", modo: "maior" },
      { id: "ativos", label: "Somente ativos", tipo: "booleano", coluna: "ativo" },
    ],
    colunas: [
      { id: "produto", label: "Produto", tipo: "texto", obrigatoria: true },
      { id: "categoria", label: "Categoria", tipo: "texto" },
      { id: "qtd", label: "Quantidade", tipo: "numero", totalizar: "soma" },
      {
        id: "valor",
        label: "Valor",
        tipo: "moeda",
        totalizar: "soma",
        permissao: "relatorio.financeiro",
      },
      { id: "ativo", label: "Ativo", tipo: "booleano", padrao: false },
    ],
    ordenacoes: [{ id: "qtd", label: "Quantidade", coluna: "qtd" }],
    agrupamentos: [{ id: "categoria", label: "Categoria", coluna: "categoria" }],
    indicadores: [
      {
        id: "unidades",
        label: "Unidades",
        tipo: "numero",
        calcular: (l) => l.reduce((s, x) => s + Number(x.qtd ?? 0), 0),
      },
    ],
    exportacoes: ["csv", "xlsx", "pdf", "imprimir"],
    carregar: async () => LINHAS,
    ...over,
  };
}

function executar(config: unknown, acessos: Acesso[] = ADMIN) {
  return executarRelatorio({
    def: definicao(),
    config,
    acessos,
    siteId: null,
    siteNome: null,
    policy: POLICY_PADRAO,
  });
}

/* ------------------------------------------------------------------ */

describe("configuração", () => {
  it("abre com as colunas padrão da definição", () => {
    const c = configPadrao(definicao());
    expect(c.colunas).toEqual(["produto", "categoria", "qtd", "valor"]);
  });

  it("descarta coluna que não existe mais e devolve a obrigatória", () => {
    const c = normalizarConfig(definicao(), { colunas: ["qtd", "colunaAposentada"] });
    expect(c.colunas).toContain("produto");
    expect(c.colunas).not.toContain("colunaAposentada");
  });

  it("recoloca a obrigatória na posição em que a definição a declara", () => {
    const c = normalizarConfig(definicao(), { colunas: ["categoria", "qtd"] });
    expect(c.colunas[0]).toBe("produto");
  });

  it("ignora agrupamento e ordenação que a definição não oferece", () => {
    const c = normalizarConfig(definicao(), {
      colunas: ["produto"],
      agrupar: "lua",
      ordenar: { coluna: "lua", ordem: "asc" },
    });
    expect(c.agrupar).toBeUndefined();
    expect(c.ordenar).toBeUndefined();
  });

  it("limpa filtro vazio e filtro que não é do relatório", () => {
    const c = normalizarConfig(definicao(), {
      colunas: ["produto"],
      filtros: { produto: "  ", categoria: [], inexistente: "x" },
    });
    expect(c.filtros).toEqual({});
  });

  it("volta inteira da URL", () => {
    const original = normalizarConfig(definicao(), {
      colunas: ["produto", "qtd"],
      filtros: { produto: "cerveja" },
      agrupar: "categoria",
      limite: 500,
    });
    expect(decodificarConfig(codificarConfig(original))).toEqual(original);
  });

  it("recusa `?c=` adulterado em vez de confiar", () => {
    expect(decodificarConfig("nao-e-base64-de-json")).toBeNull();
    expect(decodificarConfig(null)).toBeNull();
  });

  it("descreve o pedido em português", () => {
    const def = definicao();
    const texto = descreverConfig(def, normalizarConfig(def, {
      colunas: ["produto", "qtd"],
      agrupar: "categoria",
      filtros: { produto: "cerveja" },
    }));
    expect(texto).toContain("2 colunas");
    expect(texto).toContain("agrupado por categoria");
    expect(texto).toContain("produto: cerveja");
  });
});

/* ------------------------------------------------------------------ */

describe("motor", () => {
  it("projeta as colunas na ordem escolhida", async () => {
    const r = await executar({ colunas: ["qtd", "produto"] });
    expect(r.colunas.map((c) => c.id)).toEqual(["qtd", "produto"]);
    expect(r.linhas[0]![1]).toBe("Cerveja Pilsen 350ml");
  });

  it("filtra por texto sem exigir acento nem caixa", async () => {
    const r = await executar({ colunas: ["produto"], filtros: { produto: "AGUA" } });
    expect(r.totalLinhas).toBe(1);
  });

  it("filtra por lista de opções", async () => {
    const r = await executar({ colunas: ["produto"], filtros: { categoria: ["Cervejas"] } });
    expect(r.totalLinhas).toBe(2);
  });

  it("filtra por número e por interruptor", async () => {
    const porNumero = await executar({ colunas: ["produto"], filtros: { qtdMin: 40 } });
    expect(porNumero.totalLinhas).toBe(2);

    const soAtivos = await executar({ colunas: ["produto"], filtros: { ativos: true } });
    expect(soAtivos.totalLinhas).toBe(3);
  });

  it("interruptor desligado significa 'não me importo', não 'só os falsos'", async () => {
    const r = await executar({ colunas: ["produto"], filtros: { ativos: false } });
    expect(r.totalLinhas).toBe(LINHAS.length);
  });

  it("ordena pelo tipo da coluna, não pelo texto formatado", async () => {
    const r = await executar({
      colunas: ["produto", "qtd"],
      ordenar: { coluna: "qtd", ordem: "desc" },
    });
    expect(r.linhas.map((l) => l[0])).toEqual([
      "Cerveja Pilsen 350ml",
      "Refrigerante cola 2L",
      "Cerveja IPA 355ml",
      "Água com gás 500ml",
    ]);
  });

  it("agrupa com subtotal por grupo", async () => {
    const r = await executar({ colunas: ["produto", "qtd"], agrupar: "categoria" });
    expect(r.grupos).not.toBeNull();
    const cervejas = r.grupos!.find((g) => g.chave === "Cervejas")!;
    expect(cervejas.total).toBe(2);
    expect(cervejas.subtotais.at(-1)).toBe("150");
  });

  it("totaliza só o que a coluna manda totalizar", async () => {
    const r = await executar({ colunas: ["produto", "qtd"] });
    expect(r.totais[0]).toBe("Total");
    expect(r.totais.at(-1)).toBe("195");
  });

  it("calcula indicador sobre as filtradas, não sobre a página exibida", async () => {
    const r = await executar({ colunas: ["produto"], limite: 1 });
    expect(r.exibidas).toBe(1);
    expect(r.truncado).toBe(true);
    expect(r.indicadores.find((i) => i.id === "unidades")!.valor).toBe("195");
  });

  it("corta coluna que a permissão não alcança, mesmo pedida na config", async () => {
    const r = await executar({ colunas: ["produto", "valor"] }, CAIXA);
    expect(r.colunas.map((c) => c.id)).not.toContain("valor");
    expect(r.removidos).toContain("Valor");
  });

  it("não deixa a config vazia zerar a tabela", async () => {
    const r = await executar({ colunas: [] });
    expect(r.colunas.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */

describe("layout da folha", () => {
  const colunasDe = (n: number, tipo: "texto" | "numero" = "numero") =>
    Array.from({ length: n }, (_, i) => ({ label: `Col ${i}`, tipo } as const));

  it("mantém em pé quando são poucas colunas", () => {
    const p = planejarPdf(colunasDe(4), [["1", "2", "3", "4"]]);
    expect(p.orientacao).toBe("retrato");
    expect(p.escala).toBe(1);
  });

  it("deita a folha sozinha quando passam de sete", () => {
    const p = planejarPdf(colunasDe(12), []);
    expect(p.orientacao).toBe("paisagem");
    expect(p.motivo).toContain("12 colunas");
  });

  it("encolhe fonte e margem em vez de cortar conteúdo", () => {
    const p = planejarPdf(colunasDe(22, "texto"), []);
    expect(p.escala).toBeLessThan(1);
    expect(p.fontePt).toBeGreaterThanOrEqual(6);
    expect(p.margemMm).toBeLessThan(14);
    expect(p.motivo).toContain("fonte reduzida");
  });

  it("manda a coluna larga quebrar quando nem encolher resolve", () => {
    const largas = Array.from({ length: 6 }, (_, i) => ({
      label: `Observações ${i}`,
      tipo: "texto" as const,
    }));
    const colunas = [...largas, ...colunasDe(10)];
    const linhas = [
      [...Array(6).fill("x".repeat(90)), ...Array(10).fill("1")],
    ];
    const p = planejarPdf(colunas, linhas);
    expect(p.quebra.slice(0, 6)).toEqual(Array(6).fill(true));
    // Quebrar é o último recurso: as numéricas continuam em uma linha só.
    expect(p.quebra.slice(6)).toEqual(Array(10).fill(false));
    expect(p.motivo).toContain("quebram");
  });

  it("distribui 100% de largura, sempre", () => {
    for (const n of [1, 3, 8, 17]) {
      const p = planejarPdf(colunasDe(n), []);
      expect(p.larguras).toHaveLength(n);
      expect(p.larguras.reduce((s, x) => s + x, 0)).toBeCloseTo(100, 1);
    }
  });

  it("obedece a dica do relatório quando ela existe", () => {
    const p = planejarPdf(colunasDe(3), [], { orientacao: "paisagem" });
    expect(p.orientacao).toBe("paisagem");
  });

  it("mede pelo conteúdo, não pelo maior valor solto", () => {
    const curtas = Array.from({ length: 20 }, () => ["ab"]);
    const [largura] = medirColunas([{ label: "X", tipo: "texto" }], [...curtas, ["y".repeat(300)]]);
    // Um outlier em 21 linhas não pode espremer o resto: o p90 manda.
    expect(largura).toBeLessThan(46);
  });

  it("não quebra com zero colunas", () => {
    const p = planejarPdf([], []);
    expect(p.larguras).toEqual([]);
    expect(p.orientacao).toBe("retrato");
  });
});
