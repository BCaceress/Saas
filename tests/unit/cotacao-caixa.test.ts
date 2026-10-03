import { describe, expect, it } from "vitest";
import { agruparCaixa, grupoDaCotacao } from "@/app/(app)/cotacoes/_caixa";
import type { CotacaoRow } from "@/app/(app)/cotacoes/_compra-types";

const AGORA = new Date("2026-09-16T12:00:00Z").getTime();
const horas = (h: number) => new Date(AGORA + h * 3600_000).toISOString();

const linha = (p: Partial<CotacaoRow>): CotacaoRow => ({
  id: p.id ?? "x",
  numero: "COT-00001",
  titulo: "Teste",
  status: "ABERTA",
  siteNome: "Loja",
  prazoResposta: null,
  criadaEm: horas(-72),
  totalItens: 3,
  totalConvidados: 3,
  totalRespondidos: 0,
  totalRecusados: 0,
  melhorTotal: null,
  ultimaRespostaEm: null,
  pedidosParados: 0,
  repete: false,
  geradaPorRecorrencia: false,
  ...p,
});

describe("grupoDaCotacao", () => {
  it("todos responderam (recusa conta como fechada) → decidir", () => {
    expect(grupoDaCotacao(linha({ totalRespondidos: 2, totalRecusados: 1 }), AGORA)).toBe("decidir");
  });

  it("decidir ganha de prazo e de resposta nova", () => {
    const l = linha({ totalRespondidos: 3, prazoResposta: horas(2), ultimaRespostaEm: horas(-1) });
    expect(grupoDaCotacao(l, AGORA)).toBe("decidir");
  });

  it("prazo em menos de um dia com gente devendo → prazo (inclusive vencido)", () => {
    expect(grupoDaCotacao(linha({ prazoResposta: horas(5) }), AGORA)).toBe("prazo");
    expect(grupoDaCotacao(linha({ prazoResposta: horas(-5) }), AGORA)).toBe("prazo");
    expect(grupoDaCotacao(linha({ prazoResposta: horas(48) }), AGORA)).toBe("aguardando");
  });

  it("resposta nas últimas 24h → novas; mais antiga → aguardando", () => {
    expect(grupoDaCotacao(linha({ totalRespondidos: 1, ultimaRespostaEm: horas(-3) }), AGORA)).toBe("novas");
    expect(grupoDaCotacao(linha({ totalRespondidos: 1, ultimaRespostaEm: horas(-30) }), AGORA)).toBe(
      "aguardando",
    );
  });

  it("concluída só aparece com pedido parado", () => {
    expect(grupoDaCotacao(linha({ status: "DECIDIDA" }), AGORA)).toBeNull();
    expect(grupoDaCotacao(linha({ status: "DECIDIDA", pedidosParados: 1 }), AGORA)).toBe("pedido-parado");
  });

  it("cancelada e encerrada sem resposta ficam fora", () => {
    expect(grupoDaCotacao(linha({ status: "CANCELADA" }), AGORA)).toBeNull();
    expect(grupoDaCotacao(linha({ status: "ENCERRADA" }), AGORA)).toBeNull();
    expect(grupoDaCotacao(linha({ status: "ENCERRADA", totalRespondidos: 1 }), AGORA)).toBe("decidir");
  });
});

describe("agruparCaixa", () => {
  it("ordena os grupos por urgência e omite os vazios", () => {
    const grupos = agruparCaixa(
      [
        linha({ id: "r", status: "RASCUNHO" }),
        linha({ id: "p", status: "DECIDIDA", pedidosParados: 1 }),
        linha({ id: "a" }),
      ],
      AGORA,
    );
    expect(grupos.map((g) => g.grupo)).toEqual(["pedido-parado", "rascunho", "aguardando"]);
  });

  it("dentro de prazo, o que vence antes vem primeiro; rascunho da repetição antes", () => {
    const [prazo] = agruparCaixa(
      [linha({ id: "tarde", prazoResposta: horas(10) }), linha({ id: "cedo", prazoResposta: horas(1) })],
      AGORA,
    );
    expect(prazo.linhas.map((l) => l.id)).toEqual(["cedo", "tarde"]);

    const [rasc] = agruparCaixa(
      [
        linha({ id: "mao", status: "RASCUNHO" }),
        linha({ id: "auto", status: "RASCUNHO", geradaPorRecorrencia: true }),
      ],
      AGORA,
    );
    expect(rasc.linhas.map((l) => l.id)).toEqual(["auto", "mao"]);
  });
});
