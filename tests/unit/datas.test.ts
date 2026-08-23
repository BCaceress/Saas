import { afterEach, describe, expect, it, vi } from "vitest";
import {
  diaDaLoja,
  horaDaLoja,
  inicioDoDiaLoja,
  inicioDoDiaLojaEm,
  partesDoDiaLoja,
} from "@/lib/datas";
import { resolvePeriodoVendas } from "@/app/(mobile)/m/vendas/_periodo";

/**
 * O caso que motivou estas funções: 22h no Brasil já é o dia seguinte em UTC.
 * O servidor da Vercel roda em UTC, e com `new Date(ano, mês, dia)` o "hoje"
 * das telas virava às 21h — o movimento do dia inteiro só aparecia em "Ontem".
 *
 * Os testes NÃO dependem do fuso do processo de propósito: é exatamente essa
 * independência que se está garantindo.
 */
const NOITE = new Date("2026-08-24T01:00:00Z"); // 23/08/2026, 22:00 em São Paulo

afterEach(() => {
  vi.useRealTimers();
});

describe("dia da loja", () => {
  it("22h no Brasil ainda é o mesmo dia, mesmo já sendo outro em UTC", () => {
    expect(diaDaLoja(NOITE)).toBe("2026-08-23");
    expect(horaDaLoja(NOITE)).toBe(22);
    expect(partesDoDiaLoja(NOITE)).toEqual({ ano: 2026, mes: 8, dia: 23 });
  });

  it("o dia começa à meia-noite da loja (03:00Z no horário padrão)", () => {
    expect(inicioDoDiaLojaEm("2026-08-23").toISOString()).toBe("2026-08-23T03:00:00.000Z");
    expect(inicioDoDiaLoja(NOITE).toISOString()).toBe("2026-08-23T03:00:00.000Z");
  });

  it("respeita o horário de verão de quando ele existia (UTC-2)", () => {
    expect(inicioDoDiaLojaEm("2018-11-05").toISOString()).toBe("2018-11-05T02:00:00.000Z");
  });
});

describe("resolvePeriodoVendas às 22h", () => {
  it("'hoje' cobre o dia corrente da loja, não o do servidor", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOITE);

    const p = resolvePeriodoVendas({});
    expect(p.preset).toBe("hoje");
    expect(p.inicio.toISOString()).toBe("2026-08-23T03:00:00.000Z");
    expect(p.fim.toISOString()).toBe("2026-08-24T03:00:00.000Z");
    // A venda das 22h precisa cair DENTRO da janela — era o defeito.
    expect(NOITE >= p.inicio && NOITE < p.fim).toBe(true);
    expect(p.labelLongo).toBe("23/08/2026");
  });

  it("'ontem' é o dia anterior da loja, sem sobrepor hoje", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOITE);

    const p = resolvePeriodoVendas({ p: "ontem" });
    expect(p.inicio.toISOString()).toBe("2026-08-22T03:00:00.000Z");
    expect(p.fim.toISOString()).toBe("2026-08-23T03:00:00.000Z");
    expect(p.incluiHoje).toBe(false);
  });
});
