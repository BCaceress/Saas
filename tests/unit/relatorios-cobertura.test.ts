import { describe, expect, it } from "vitest";
import { RELATORIOS } from "@/lib/relatorios/catalogo";
import { getDefinicao, temDefinicao } from "@/lib/relatorios/definicoes";

/**
 * A Central promete a MESMA coisa para todo relatório: visualizar e exportar,
 * sem tela dedicada no meio. Quem entra no catálogo sem definição quebra a
 * promessa — e é este teste que avisa antes de o operador descobrir clicando.
 */
describe("cobertura do motor de relatórios", () => {
  it("todo relatório disponível tem definição", () => {
    const sem = RELATORIOS.filter(
      (r) => r.destino.tipo !== "indisponivel" && !temDefinicao(r.id),
    ).map((r) => r.id);

    expect(sem, `sem definição: ${sem.join(", ")}`).toEqual([]);
  });

  it("definição só cita colunas que existem", () => {
    for (const rel of RELATORIOS) {
      if (rel.destino.tipo === "indisponivel") continue;
      const def = getDefinicao(rel.id)!;

      expect(def.colunas.length, `${rel.id} sem colunas`).toBeGreaterThan(0);

      const ids = new Set(def.colunas.map((c) => c.id));
      for (const o of def.ordenacoes) {
        expect(ids.has(o.coluna), `${rel.id}: ordenação ${o.coluna} não é coluna`).toBe(true);
      }
      for (const g of def.agrupamentos) {
        expect(ids.has(g.coluna), `${rel.id}: agrupamento ${g.coluna} não é coluna`).toBe(true);
      }
      if (def.ordenacaoPadrao) {
        expect(
          ids.has(def.ordenacaoPadrao.coluna),
          `${rel.id}: ordenação padrão ${def.ordenacaoPadrao.coluna} não é coluna`,
        ).toBe(true);
      }
      // Filtro NÃO precisa ser coluna: ele roda sobre a linha crua, então pode
      // peneirar por um campo que ninguém exibe ("conferido", "vencido").
    }
  });
});
