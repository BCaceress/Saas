import { describe, it, expect } from "vitest";
import {
  can,
  isAdmin,
  MATRIZ,
  podeEmAlguma,
  sitesPermitidos,
  whereSite,
  type Acesso,
} from "@/lib/permissoes";

// Autorização por loja. O erro perigoso não é negar demais — é liberar de leve:
// um caixa da loja A movimentando estoque da loja B some no meio do movimento e
// só aparece na contagem do mês seguinte.

const LOJA_A = "site-a";
const LOJA_B = "site-b";

const admin: Acesso[] = [{ perfil: "ADMINISTRADOR", siteId: null }];
const caixaA: Acesso[] = [{ perfil: "CAIXA", siteId: LOJA_A }];

/** Uma permissão que o perfil de caixa realmente tem, seja qual for a matriz. */
const PERM_CAIXA = MATRIZ.CAIXA[0];

describe("isAdmin", () => {
  it("reconhece administrador e recusa os demais", () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(caixaA)).toBe(false);
    expect(isAdmin([])).toBe(false);
  });
});

describe("can", () => {
  it("acesso global vale em qualquer loja", () => {
    expect(can(admin, PERM_CAIXA, LOJA_A)).toBe(true);
    expect(can(admin, PERM_CAIXA, LOJA_B)).toBe(true);
  });

  it("acesso por loja NÃO vaza para outra loja", () => {
    expect(can(caixaA, PERM_CAIXA, LOJA_A)).toBe(true);
    expect(can(caixaA, PERM_CAIXA, LOJA_B)).toBe(false);
  });

  it("sem acesso nenhum, nada é permitido", () => {
    expect(can([], PERM_CAIXA, LOJA_A)).toBe(false);
  });

  it("perfil que não tem a permissão continua sem ela na própria loja", () => {
    const permQueCaixaNaoTem = MATRIZ.ADMINISTRADOR.find(
      (p) => !MATRIZ.CAIXA.includes(p),
    );
    if (!permQueCaixaNaoTem) return; // matriz sem diferença: nada a testar
    expect(can(caixaA, permQueCaixaNaoTem, LOJA_A)).toBe(false);
  });
});

describe("união de acessos", () => {
  it("o poder efetivo é a soma dos acessos, loja a loja", () => {
    const duasLojas: Acesso[] = [
      { perfil: "CAIXA", siteId: LOJA_A },
      { perfil: "CAIXA", siteId: LOJA_B },
    ];
    expect(can(duasLojas, PERM_CAIXA, LOJA_A)).toBe(true);
    expect(can(duasLojas, PERM_CAIXA, LOJA_B)).toBe(true);
    expect(sitesPermitidos(duasLojas, PERM_CAIXA)).toEqual([LOJA_A, LOJA_B]);
  });
});

describe("podeEmAlguma", () => {
  it("serve para menu, e ignora a loja de propósito", () => {
    expect(podeEmAlguma(caixaA, PERM_CAIXA)).toBe(true);
    expect(podeEmAlguma([], PERM_CAIXA)).toBe(false);
  });
});

describe("whereSite", () => {
  it("acesso global não filtra", () => {
    expect(whereSite(admin, PERM_CAIXA)).toEqual({});
  });

  it("acesso por loja filtra pelas lojas permitidas", () => {
    expect(whereSite(caixaA, PERM_CAIXA)).toEqual({ siteId: { in: [LOJA_A] } });
  });

  it("sem permissão devolve lista vazia — não vaza tudo", () => {
    expect(whereSite([], PERM_CAIXA)).toEqual({ siteId: { in: [] } });
  });
});
