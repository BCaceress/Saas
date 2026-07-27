import { describe, it, expect } from "vitest";
import {
  normalizarBandeira,
  CNPJ_CREDENCIADORA,
  BANDEIRAS,
} from "@/lib/pagamentos/types";

// A bandeira normalizada vira o tBand da NFC-e (grupo card). Um mapeamento
// errado aqui = nota com bandeira trocada. Cobre os rótulos que os PSPs/TEF
// devolvem e a regra de "desconhecido → OUTROS, nunca null silencioso".
describe("normalizarBandeira", () => {
  it("mapeia rótulos comuns dos adquirentes", () => {
    expect(normalizarBandeira("visa")).toBe("VISA");
    expect(normalizarBandeira("Visa Crédito")).toBe("VISA");
    expect(normalizarBandeira("master")).toBe("MASTERCARD");
    expect(normalizarBandeira("mastercard")).toBe("MASTERCARD");
    expect(normalizarBandeira("mc")).toBe("MASTERCARD");
    expect(normalizarBandeira("amex")).toBe("AMEX");
    expect(normalizarBandeira("american express")).toBe("AMEX");
    expect(normalizarBandeira("elo")).toBe("ELO");
    expect(normalizarBandeira("hipercard")).toBe("HIPERCARD");
    expect(normalizarBandeira("hiper")).toBe("HIPERCARD");
    expect(normalizarBandeira("diners")).toBe("DINERS");
  });

  it("ignora caixa, espaços e separadores", () => {
    expect(normalizarBandeira("  MASTER-CARD ")).toBe("MASTERCARD");
    expect(normalizarBandeira("VISA_ELECTRON")).toBe("VISA");
  });

  it("desconhecido vira OUTROS (nunca palpite, nunca erro)", () => {
    expect(normalizarBandeira("bandeira-nova")).toBe("OUTROS");
  });

  it("vazio/nulo vira null (sem bandeira)", () => {
    expect(normalizarBandeira(null)).toBeNull();
    expect(normalizarBandeira(undefined)).toBeNull();
    expect(normalizarBandeira("")).toBeNull();
  });

  it("todo retorno pertence ao vocabulário BANDEIRAS", () => {
    const amostras = ["visa", "master", "elo", "xyz", "amex", "cabal", "sorocred", "aura"];
    for (const s of amostras) {
      const b = normalizarBandeira(s);
      expect(b && (BANDEIRAS as readonly string[]).includes(b)).toBe(true);
    }
  });
});

describe("CNPJ_CREDENCIADORA", () => {
  it("tem CNPJ só-dígitos de 14 para os PSPs conhecidos", () => {
    for (const cnpj of Object.values(CNPJ_CREDENCIADORA)) {
      expect(cnpj).toMatch(/^\d{14}$/);
    }
  });
});
