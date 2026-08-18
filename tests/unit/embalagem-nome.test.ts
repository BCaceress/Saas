import { describe, it, expect } from "vitest";
import { nomeDaEmbalagem } from "@/lib/fiscal/embalagem-nome";

/**
 * A embalagem criada a partir do XML fica no cadastro para sempre. "CX" não
 * diz nada na tela de compra; "Caixa com 24" diz o que o operador vai pedir.
 */
describe("nomeDaEmbalagem", () => {
  it("traduz a sigla e junta o fator", () => {
    expect(nomeDaEmbalagem("CX", 24)).toBe("Caixa com 24");
    expect(nomeDaEmbalagem("FD", 12)).toBe("Fardo com 12");
    expect(nomeDaEmbalagem("DP", 6)).toBe("Display com 6");
  });

  it("entende sigla colada no fator, como o distribuidor escreve", () => {
    expect(nomeDaEmbalagem("CX24", 24)).toBe("Caixa com 24");
  });

  it("sem fator, é só o nome", () => {
    expect(nomeDaEmbalagem("CX", 1)).toBe("Caixa");
  });

  it("unidade desconhecida vira o texto do fornecedor, não um chute", () => {
    expect(nomeDaEmbalagem("BLT", 8)).toBe("Blt com 8");
  });

  it("unidade ausente não gera nome vazio", () => {
    expect(nomeDaEmbalagem(null, 6)).toBe("Embalagem com 6");
  });
});
