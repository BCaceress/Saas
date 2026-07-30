import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import {
  CATEGORIAS,
  PARAMETROS_PADRAO,
  RELATORIOS,
  aplicarParametros,
  hrefExecucao,
  hrefExport,
  relatoriosVisiveis,
} from "@/lib/relatorios/catalogo";
import { CATALOGO, getDimensao, getMetrica } from "@/lib/analises/catalogo";
import { decodificarConsulta } from "@/lib/analises/schema";
import { gerarXlsx } from "@/lib/relatorios/xlsx";
import { proximaExecucao } from "@/lib/relatorios/agendamento";
import type { Acesso } from "@/lib/permissoes";

/**
 * O catálogo da Central é código, não dado — então é aqui que ele é conferido.
 * Um relatório que aponta para uma dimensão inexistente só apareceria como
 * "consulta inválida" na cara do operador; estes testes seguram antes.
 */

describe("catálogo da Central", () => {
  it("não repete id", () => {
    const ids = RELATORIOS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("usa categorias declaradas", () => {
    const validas = new Set(CATEGORIAS.map((c) => c.id));
    for (const r of RELATORIOS) expect(validas.has(r.categoria)).toBe(true);
  });

  it("só pede dimensão e métrica que o motor conhece", () => {
    for (const r of RELATORIOS) {
      if (r.destino.tipo !== "consulta") continue;
      const fato = CATALOGO.find((f) => f.id === r.destino.consulta.fato);
      expect(fato, `fato desconhecido em ${r.id}`).toBeDefined();

      for (const d of r.destino.consulta.dimensoes) {
        expect(getDimensao(fato!, d), `${r.id}: dimensão ${d}`).toBeDefined();
      }
      for (const m of r.destino.consulta.metricas) {
        expect(getMetrica(fato!, m), `${r.id}: métrica ${m}`).toBeDefined();
      }
      const por = r.destino.consulta.ordenar?.por;
      if (por) {
        const conhecida = getMetrica(fato!, por) ?? getDimensao(fato!, por);
        expect(conhecida, `${r.id}: ordenação por ${por}`).toBeDefined();
      }
    }
  });

  it("relatório indisponível não oferece execução nem export", () => {
    for (const r of RELATORIOS) {
      if (r.destino.tipo !== "indisponivel") continue;
      expect(hrefExecucao(r, PARAMETROS_PADRAO)).toBeNull();
      expect(r.exportacoes).toHaveLength(0);
    }
  });

  it("todo export prometido tem endereço", () => {
    for (const r of RELATORIOS) {
      for (const formato of r.exportacoes) {
        expect(hrefExport(r, PARAMETROS_PADRAO, formato), `${r.id}: ${formato}`).toBeTruthy();
      }
    }
  });

  it("o link de execução carrega o DSL de volta inteiro", () => {
    const rel = RELATORIOS.find((r) => r.id === "vendas-produto")!;
    const href = hrefExecucao(rel, { periodo: "7d", filtros: { categoria: "Cervejas" } })!;
    const q = new URL(href, "http://x").searchParams.get("q");
    const consulta = decodificarConsulta(q);

    expect(consulta?.periodo.preset).toBe("7d");
    expect(consulta?.filtros).toContainEqual({ campo: "categoria", op: "contem", valor: "Cervejas" });
  });

  it("filtro em branco não vira cláusula", () => {
    const rel = RELATORIOS.find((r) => r.id === "vendas-produto")!;
    if (rel.destino.tipo !== "consulta") throw new Error("esperava consulta");
    const c = aplicarParametros(rel.destino.consulta, {
      periodo: "30d",
      filtros: { categoria: "  ", produto: "" },
    });
    expect(c.filtros).toHaveLength(0);
  });

  it("período dedicado entra na query da tela dedicada", () => {
    const rel = RELATORIOS.find((r) => r.id === "financeiro-fluxo-caixa")!;
    const href = hrefExecucao(rel, { periodo: "custom", de: "2026-01-01", ate: "2026-01-31", filtros: {} })!;
    expect(href).toContain("periodo=custom");
    expect(href).toContain("de=2026-01-01");
    expect(href).toContain("ate=2026-01-31");
  });

  it("preserva o filtro que já vinha no href da tela", () => {
    const rel = RELATORIOS.find((r) => r.id === "estoque-sem-estoque")!;
    // Sem período nos filtros: o href sai limpo, com o filtro da tela intacto.
    expect(hrefExecucao(rel, PARAMETROS_PADRAO)).toBe("/estoque?filtro=sem");
  });
});

describe("permissões da Central", () => {
  const caixa: Acesso[] = [{ perfil: "CAIXA", siteId: null }];
  const contador: Acesso[] = [{ perfil: "CONTADOR", siteId: null }];
  const admin: Acesso[] = [{ perfil: "ADMINISTRADOR", siteId: null }];

  it("operador de caixa não enxerga relatório financeiro", () => {
    const ids = relatoriosVisiveis(caixa).map((r) => r.id);
    expect(ids.some((id) => id.startsWith("financeiro-"))).toBe(false);
  });

  it("contador vê relatório, mas não o financeiro", () => {
    const vistos = relatoriosVisiveis(contador);
    expect(vistos.length).toBeGreaterThan(0);
    expect(vistos.some((r) => r.permissao === "relatorio.financeiro")).toBe(false);
  });

  it("administrador vê o catálogo inteiro", () => {
    expect(relatoriosVisiveis(admin)).toHaveLength(RELATORIOS.length);
  });
});

describe("planilha xlsx", () => {
  it("gera um zip com as partes que o Excel exige", () => {
    const arquivo = gerarXlsx({
      aba: "Vendas",
      cabecalho: ["Produto", "Receita"],
      linhas: [["Cerveja & Cia <lata>", 1234.5]],
      rodape: ["Total", 1234.5],
    });

    const partes = unzipSync(arquivo);
    expect(Object.keys(partes)).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "_rels/.rels",
        "xl/workbook.xml",
        "xl/_rels/workbook.xml.rels",
        "xl/styles.xml",
        "xl/worksheets/sheet1.xml",
      ]),
    );

    const folha = strFromU8(partes["xl/worksheets/sheet1.xml"]);
    // Texto escapado, número cru (é o que faz a coluna somar no Excel).
    expect(folha).toContain("Cerveja &amp; Cia &lt;lata&gt;");
    expect(folha).toContain("<v>1234.5</v>");
    expect(folha).toContain('r="B3"'); // rodapé na terceira linha
  });

  it("nome de aba inválido não derruba o arquivo", () => {
    const arquivo = gerarXlsx({
      aba: "Compras/Fornecedor: 2026 [muito longo para uma aba do Excel]",
      cabecalho: ["A"],
      linhas: [["x"]],
    });
    const workbook = strFromU8(unzipSync(arquivo)["xl/workbook.xml"]);
    const nome = /name="([^"]*)"/.exec(workbook)?.[1] ?? "";
    expect(nome.length).toBeLessThanOrEqual(31);
    expect(nome).not.toMatch(/[:\\/?*[\]]/);
  });
});

describe("agendamento (arquitetura)", () => {
  const base = new Date(2026, 6, 30, 10, 0, 0); // quinta, 10h

  it("diário pula para amanhã quando a hora já passou", () => {
    const p = proximaExecucao({ frequencia: "DIARIO", hora: 7 }, base);
    expect(p.getDate()).toBe(31);
    expect(p.getHours()).toBe(7);
  });

  it("semanal cai no próximo dia da semana pedido", () => {
    const p = proximaExecucao({ frequencia: "SEMANAL", hora: 7, diaSemana: 1 }, base);
    expect(p.getDay()).toBe(1);
    expect(p.getTime()).toBeGreaterThan(base.getTime());
  });

  it("mensal nunca pula o mês curto", () => {
    const fevereiro = new Date(2026, 1, 20, 10, 0, 0);
    const p = proximaExecucao({ frequencia: "MENSAL", hora: 7, diaMes: 28 }, fevereiro);
    expect(p.getMonth()).toBe(1);
    expect(p.getDate()).toBe(28);
  });
});
