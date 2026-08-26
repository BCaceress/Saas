import { describe, it, expect } from "vitest";
import { nomeDaEmbalagem } from "@/lib/fiscal/embalagem-nome";

/**
 * O nome da embalagem é só o nome. Quantas unidades cabem mora em
 * `fatorConversao` — juntar os dois num campo de texto fazia o cadastro
 * mentir assim que o fornecedor mudava o fardo.
 */
describe("nomeDaEmbalagem", () => {
  it("traduz a sigla do fornecedor para palavra", () => {
    expect(nomeDaEmbalagem("CX")).toBe("Caixa");
    expect(nomeDaEmbalagem("FD")).toBe("Fardo");
    expect(nomeDaEmbalagem("DP")).toBe("Display");
  });

  it("entende a sigla colada no fator e descarta o número", () => {
    expect(nomeDaEmbalagem("CX24")).toBe("Caixa");
    expect(nomeDaEmbalagem("FD12")).toBe("Fardo");
  });

  it("nunca carrega a quantidade no nome", () => {
    expect(nomeDaEmbalagem("CX")).not.toMatch(/\d/);
    expect(nomeDaEmbalagem("CAIXA")).toBe("Caixa");
  });

  it("mantém o texto do fornecedor quando a sigla é desconhecida", () => {
    expect(nomeDaEmbalagem("BLT")).toBe("Blt");
  });

  it("sem unidade, nome genérico", () => {
    expect(nomeDaEmbalagem(null)).toBe("Embalagem");
    expect(nomeDaEmbalagem("  ")).toBe("Embalagem");
  });
});
