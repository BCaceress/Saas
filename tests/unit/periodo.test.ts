import { describe, expect, it } from "vitest";
import { resolvePeriodo } from "@/lib/periodo";

const DIA = 86400000;
const dias = (p: { inicio: Date; fim: Date }) => Math.round((p.fim.getTime() - p.inicio.getTime()) / DIA);

describe("resolvePeriodo", () => {
  it("hoje cobre um dia", () => {
    expect(dias(resolvePeriodo({ periodo: "hoje" }))).toBe(1);
  });

  it("7d e 30d contam o dia de hoje", () => {
    expect(dias(resolvePeriodo({ periodo: "7d" }))).toBe(7);
    expect(dias(resolvePeriodo({ periodo: "30d" }))).toBe(30);
  });

  it("6m e 1a recuam em meses de calendário", () => {
    const seis = resolvePeriodo({ periodo: "6m" });
    const ano = resolvePeriodo({ periodo: "1a" });
    const hoje = new Date();

    // Mês de calendário, não múltiplo de 30 dias: o intervalo varia com o mês.
    expect(dias(seis)).toBeGreaterThanOrEqual(181);
    expect(dias(seis)).toBeLessThanOrEqual(185);
    expect(dias(ano)).toBeGreaterThanOrEqual(365);
    expect(dias(ano)).toBeLessThanOrEqual(367);
    expect(ano.inicio.getFullYear()).toBe(hoje.getFullYear() - 1);
    expect(seis.label).toBe("Últimos 6 meses");
  });

  it("custom respeita as datas e inclui o dia final", () => {
    const p = resolvePeriodo({ periodo: "custom", de: "2026-03-01", ate: "2026-03-31" });
    expect(dias(p)).toBe(31);
    expect(p.preset).toBe("custom");
  });

  it("custom sem data inicial cai no padrão em vez de quebrar", () => {
    expect(resolvePeriodo({ periodo: "custom" }).preset).toBe("7d");
  });

  it("período anterior tem a mesma duração e termina onde o atual começa", () => {
    const p = resolvePeriodo({ periodo: "30d" });
    expect(p.prevFim.getTime()).toBe(p.inicio.getTime());
    expect(p.fim.getTime() - p.inicio.getTime()).toBe(p.prevFim.getTime() - p.prevInicio.getTime());
  });
});
