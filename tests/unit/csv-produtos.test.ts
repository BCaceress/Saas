import { describe, expect, it } from "vitest";
import {
  CAMPOS,
  autoMapear,
  camposVisiveis,
  eanValido,
  parseBool,
  parseEan,
  parseNumero,
  parseUnidade,
  templateCsv,
} from "@/app/(app)/produtos/_sheets/csv-campos";
import { policyDoTenant } from "@/lib/estoque-estrategia";

const POLICY_MIN_IDEAL = policyDoTenant({ tipoControleEstoque: "MINIMO_IDEAL" });
const POLICY_GIRO = policyDoTenant({ tipoControleEstoque: "ROTATIVIDADE" });

describe("parseNumero", () => {
  it("lê vírgula como decimal e ponto como milhar", () => {
    expect(parseNumero("7,90")).toBe(7.9);
    expect(parseNumero("1.234,56")).toBe(1234.56);
    expect(parseNumero("R$ 89,90")).toBe(89.9);
  });

  it("aceita ponto decimal quando não há vírgula", () => {
    expect(parseNumero("7.90")).toBe(7.9);
    expect(parseNumero("1.234.567")).toBe(1234567);
  });

  it("devolve null para vazio e lixo", () => {
    expect(parseNumero("")).toBeNull();
    expect(parseNumero(undefined)).toBeNull();
    expect(parseNumero("un")).toBeNull();
  });
});

describe("parseBool", () => {
  it("entende as grafias que saem de planilha", () => {
    for (const v of ["sim", "SIM", "S", "1", "x", "true", "Verdadeiro"]) {
      expect(parseBool(v, false)).toBe(true);
    }
    for (const v of ["não", "nao", "N", "0", "false"]) {
      expect(parseBool(v, true)).toBe(false);
    }
  });

  it("cai no padrão quando vazio ou desconhecido", () => {
    expect(parseBool("", true)).toBe(true);
    expect(parseBool(undefined, false)).toBe(false);
    expect(parseBool("talvez", true)).toBe(true);
  });
});

describe("parseEan", () => {
  it("aceita código íntegro, com ou sem pontuação", () => {
    expect(parseEan("7891050000101")).toEqual({ ean: "7891050000101", ajustado: false });
    expect(parseEan(" 7.891.050.000.101 ").ean).toBe("7891050000101");
  });

  it('remove o ",0" que a planilha cola no fim', () => {
    // Caso real da importação: Whisky Passport 1L.
    expect(parseEan("7891050000101,0")).toEqual({ ean: "7891050000101", ajustado: true });
    expect(parseEan("7891050000101.00").ean).toBe("7891050000101");
    // Já colado por uma importação anterior (14 dígitos terminando em 0).
    expect(parseEan("78910500001010").ean).toBe("7891050000101");
  });

  it("repõe zeros à esquerda comidos pelo Excel", () => {
    // Monster Mango Loco: UPC-A 070847033301.
    expect(parseEan("70847033301").ean).toBe("070847033301");
    // Zero à esquerda comido E ",0" colado no fim.
    expect(parseEan("708470333010").ean).toBe("070847033301");
  });

  it("não inventa código a partir de notação científica", () => {
    expect(parseEan("7,89105E+12")).toEqual({
      ean: null,
      ajustado: false,
      problema: "cientifico",
    });
  });

  it("mantém o que não fecha, sinalizando o dígito verificador", () => {
    const r = parseEan("1234567890123");
    expect(r.ean).toBe("1234567890123");
    expect(r.problema).toBe("digito");
    expect(r.ajustado).toBe(false);
  });

  it("vazio não vira código", () => {
    expect(parseEan("").ean).toBeNull();
    expect(parseEan(undefined).ean).toBeNull();
  });

  it("valida o dígito verificador nos comprimentos de GTIN", () => {
    expect(eanValido("7891050000101")).toBe(true); // EAN-13
    expect(eanValido("070847033301")).toBe(true); // UPC-A
    expect(eanValido("7891050000102")).toBe(false);
    expect(eanValido("789105000010")).toBe(false); // comprimento truncado
  });
});

describe("parseUnidade", () => {
  it("normaliza as unidades aceitas", () => {
    expect(parseUnidade("un")).toBe("UN");
    expect(parseUnidade("ML")).toBe("ML");
    expect(parseUnidade("gramas")).toBe("G");
    expect(parseUnidade("")).toBe("UN");
  });

  it("devolve null no que não reconhece (vira aviso na importação)", () => {
    expect(parseUnidade("litro")).toBeNull();
  });
});

describe("camposVisiveis", () => {
  it("esconde metas fixas de quem controla por giro", () => {
    const keys = camposVisiveis(POLICY_GIRO, { completo: true }).map((c) => c.key);
    expect(keys).not.toContain("estoqueMinimo");
    expect(keys).not.toContain("estoqueIdeal");
  });

  it("modelo básico é um subconjunto do completo", () => {
    const basico = camposVisiveis(POLICY_MIN_IDEAL).map((c) => c.key);
    const completo = camposVisiveis(POLICY_MIN_IDEAL, { completo: true }).map((c) => c.key);
    expect(basico.length).toBeLessThan(completo.length);
    expect(basico.every((k) => completo.includes(k))).toBe(true);
    expect(basico).toContain("nome");
    expect(basico).toContain("subcategoria");
  });
});

describe("templateCsv", () => {
  it("gera cabeçalho com os campos e três linhas de exemplo", () => {
    const campos = camposVisiveis(POLICY_MIN_IDEAL);
    const linhas = templateCsv(campos).trim().split("\r\n");
    expect(linhas).toHaveLength(4);
    expect(linhas[0].replace("﻿", "").split(";")).toEqual(campos.map((c) => c.key));
    // Cada linha de exemplo tem uma célula por coluna (vazias inclusive).
    for (const l of linhas.slice(1)) {
      expect(l.split(";").length).toBe(campos.length);
    }
  });
});

describe("autoMapear", () => {
  it("casa 100% das colunas do próprio modelo", () => {
    const campos = camposVisiveis(POLICY_MIN_IDEAL, { completo: true });
    const map = autoMapear(
      campos.map((c) => c.key),
      campos,
    );
    for (const c of campos) expect(map[c.key]).toBe(c.key);
  });

  it("casa cabeçalho humano por apelido", () => {
    const campos = camposVisiveis(POLICY_MIN_IDEAL, { completo: true });
    const map = autoMapear(
      ["Descrição do produto", "Cód. de barras", "Preço de venda", "Fabricante", "Qtd"],
      campos,
    );
    expect(map.nome).toBe("Descrição do produto");
    expect(map.ean).toBe("Cód. de barras");
    expect(map.precoVenda).toBe("Preço de venda");
    expect(map.marca).toBe("Fabricante");
    expect(map.estoqueInicial).toBe("Qtd");
  });

  it("não deixa dois campos disputarem a mesma coluna", () => {
    const campos = camposVisiveis(POLICY_MIN_IDEAL, { completo: true });
    const map = autoMapear(["nome", "custo", "custoFornecedor"], campos);
    const usados = Object.values(map);
    expect(new Set(usados).size).toBe(usados.length);
    expect(map.custo).toBe("custo");
  });

  it("todo campo tem exemplo para as três linhas do modelo", () => {
    for (const c of CAMPOS) expect(c.exemplo).toHaveLength(3);
  });
});
