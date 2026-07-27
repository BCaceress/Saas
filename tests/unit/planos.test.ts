import { describe, it, expect } from "vitest";
import {
  ADDONS,
  PLANOS,
  cabeMais,
  featuresDe,
  limitesDe,
  planoAtendeOuSuperior,
  planoMinimo,
  temFeature,
} from "@/lib/planos";

// Plano responde "essa conta contratou?". Um falso positivo aqui entrega
// módulo pago de graça; um falso negativo tranca quem pagou.

const prata = { plano: "PRATA" as const, addons: [], lojasExtras: 0 };
const ouro = { plano: "OURO" as const, addons: [], lojasExtras: 0 };

describe("temFeature", () => {
  it("libera o que o plano inclui", () => {
    expect(temFeature(ouro, "pdv")).toBe(true);
    expect(temFeature(prata, "pdv")).toBe(false);
  });

  it("add-on destrava feature fora do plano", () => {
    expect(temFeature(ouro, "fiscal")).toBe(false);
    expect(temFeature({ ...ouro, addons: ["fiscal"] }, "fiscal")).toBe(true);
  });

  it("slug desconhecido não destrava nada", () => {
    expect(temFeature({ ...prata, addons: ["fiscal-pirata"] }, "fiscal")).toBe(false);
  });
});

describe("featuresDe", () => {
  it("soma plano + add-ons sem duplicar", () => {
    const fs = featuresDe({ ...ouro, addons: ["fiscal", "autoatendimento"] });
    expect(fs).toContain("pdv");
    expect(fs).toContain("fiscal");
    expect(fs).toContain("autoatendimento");
    expect(new Set(fs).size).toBe(fs.length);
  });
});

describe("limitesDe", () => {
  it("loja extra aumenta o teto de lojas", () => {
    const base = PLANOS.OURO.limites.sites!;
    expect(limitesDe({ ...ouro, lojasExtras: 2 }).sites).toBe(base + 2);
  });

  it("plano ilimitado continua ilimitado", () => {
    expect(limitesDe({ plano: "DIAMANTE", addons: [], lojasExtras: 3 }).sites).toBeNull();
  });
});

describe("cabeMais", () => {
  it("cabe enquanto o uso for MENOR que o teto", () => {
    const teto = PLANOS.PRATA.limites.produtos!;
    expect(cabeMais(prata, "produtos", teto - 1)).toBe(true);
    // No teto não cabe mais: a checagem roda ANTES de criar o registro.
    expect(cabeMais(prata, "produtos", teto)).toBe(false);
    expect(cabeMais(prata, "produtos", teto + 10)).toBe(false);
  });

  it("ilimitado sempre cabe", () => {
    expect(cabeMais({ plano: "DIAMANTE", addons: [], lojasExtras: 0 }, "produtos", 999_999)).toBe(
      true,
    );
  });
});

describe("ordem comercial", () => {
  it("compara planos para upgrade/downgrade", () => {
    expect(planoAtendeOuSuperior("OURO", "PRATA")).toBe(true);
    expect(planoAtendeOuSuperior("OURO", "OURO")).toBe(true);
    expect(planoAtendeOuSuperior("PRATA", "OURO")).toBe(false);
  });

  it("aponta o menor plano que inclui a feature", () => {
    expect(planoMinimo("pdv")).toBe("OURO");
    expect(planoMinimo("comodato")).toBe("DIAMANTE");
    // Só existe como add-on: nenhum plano inclui.
    expect(planoMinimo("fiscal")).toBeNull();
  });
});

describe("coerência da tabela comercial", () => {
  it("todo add-on exige um plano que existe e tem preço positivo", () => {
    for (const [slug, def] of Object.entries(ADDONS)) {
      expect(PLANOS[def.requerPlano], `add-on ${slug}`).toBeDefined();
      expect(def.preco, `add-on ${slug}`).toBeGreaterThan(0);
    }
  });

  it("plano maior nunca custa menos que o menor", () => {
    expect(PLANOS.OURO.preco).toBeGreaterThan(PLANOS.PRATA.preco);
    expect(PLANOS.DIAMANTE.preco).toBeGreaterThan(PLANOS.OURO.preco);
  });
});
