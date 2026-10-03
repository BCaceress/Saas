import { describe, expect, it, vi } from "vitest";

// O job importa o banco; aqui só interessam as duas funções puras.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ basePrisma: {}, db: {} }));
vi.mock("@/app/(app)/cotacoes/_data", () => ({ loadSugestoesReposicao: vi.fn() }));
vi.mock("@/lib/compras/cotacao-push", () => ({ avisarCotacaoRecorrente: vi.fn() }));

const { diaLocal, quantidadeDeReposicao } = await import("@/lib/compras/cotacao-recorrente");

describe("diaLocal", () => {
  it("usa o fuso de São Paulo, não o do servidor", () => {
    // 02:00 UTC de quinta = 23:00 de quarta em SP.
    const d = diaLocal(new Date("2026-09-17T02:00:00Z"));
    expect(d.chave).toBe("2026-09-16");
    expect(d.semana).toBe(3);
  });

  it("domingo é zero", () => {
    expect(diaLocal(new Date("2026-09-20T15:00:00Z")).semana).toBe(0);
  });
});

describe("quantidadeDeReposicao", () => {
  it("arredonda a embalagem para cima", () => {
    expect(quantidadeDeReposicao(13, 12)).toBe(2);
    expect(quantidadeDeReposicao(12, 12)).toBe(1);
    expect(quantidadeDeReposicao(0.5, 1)).toBe(1);
  });

  it("sem necessidade, fica de fora", () => {
    expect(quantidadeDeReposicao(0, 12)).toBe(0);
    expect(quantidadeDeReposicao(-4, 12)).toBe(0);
    expect(quantidadeDeReposicao(Number.NaN, 12)).toBe(0);
  });

  it("fator inválido vira unidade", () => {
    expect(quantidadeDeReposicao(5, 0)).toBe(5);
  });
});
