import { describe, expect, it } from "vitest";
import {
  montarLinhaDoTempo,
  type EntradaLinhaDoTempo,
} from "@/lib/compras/cotacao-linha-do-tempo";

const base: EntradaLinhaDoTempo = {
  criadaEm: "2026-09-01T10:00:00.000Z",
  geradaPorRecorrencia: false,
  encerradaEm: null,
  decididaEm: "2026-09-03T10:00:00.000Z",
  canceladaEm: null,
  convites: [
    {
      id: "c1",
      supplierNome: "Flamarsul",
      status: "RESPONDIDA",
      abertoEm: "2026-09-01T12:00:00.000Z",
      respondidaEm: "2026-09-02T09:00:00.000Z",
      origemResposta: "link",
      observacao: null,
      envios: [
        {
          id: "e1",
          canal: "WHATSAPP",
          contatoNome: "João",
          reenvio: false,
          sucesso: true,
          enviadoEm: "2026-09-01T11:00:00.000Z",
          automatico: false,
          status: null,
        },
      ],
    },
    {
      id: "c2",
      supplierNome: "Ambev",
      status: "RECUSADA",
      abertoEm: null,
      respondidaEm: "2026-09-02T08:00:00.000Z",
      origemResposta: null,
      observacao: "sem estoque",
      envios: [],
    },
  ],
  pedidos: [
    {
      id: "p1",
      numero: "PC-00010",
      supplierNome: "Flamarsul",
      status: "RECEBIDO",
      criadoEm: "2026-09-03T10:00:00.000Z",
      enviadoEm: "2026-09-03T11:00:00.000Z",
      recebidoEm: "2026-09-05T10:00:00.000Z",
      valorTotal: 1000,
      valorRecebido: 1050,
    },
  ],
};

describe("montarLinhaDoTempo", () => {
  it("ordena do mais recente para o mais antigo", () => {
    const ev = montarLinhaDoTempo(base);
    const datas = ev.map((e) => e.em);
    expect(datas).toEqual([...datas].sort().reverse());
    expect(ev.at(-1)?.id).toBe("criada");
    expect(ev[0].id).toBe("pedido-recebido:p1");
  });

  it("cobre envio, abertura, resposta e recusa", () => {
    const ids = montarLinhaDoTempo(base).map((e) => e.id);
    expect(ids).toEqual(
      expect.arrayContaining(["envio:e1", "aberto:c1", "resposta:c1", "recusa:c2", "decidida"]),
    );
  });

  it("aponta faturado acima do cotado", () => {
    const rec = montarLinhaDoTempo(base).find((e) => e.id === "pedido-recebido:p1")!;
    expect(rec.tom).toBe("alerta");
    expect(rec.detalhe).toContain("+5%");
  });

  it("faturado igual ao cotado não vira alerta", () => {
    const ev = montarLinhaDoTempo({
      ...base,
      pedidos: [{ ...base.pedidos[0], valorRecebido: 1000 }],
    });
    const rec = ev.find((e) => e.id === "pedido-recebido:p1")!;
    expect(rec.tom).toBe("ok");
    expect(rec.detalhe).toContain("igual ao cotado");
  });

  it("envio que falhou é perigo", () => {
    const ev = montarLinhaDoTempo({
      ...base,
      convites: [
        { ...base.convites[0], envios: [{ ...base.convites[0].envios[0], sucesso: false }] },
      ],
    });
    expect(ev.find((e) => e.id === "envio:e1")?.tom).toBe("perigo");
  });

  it("marca a cotação gerada pela repetição", () => {
    const ev = montarLinhaDoTempo({ ...base, geradaPorRecorrencia: true });
    expect(ev.find((e) => e.id === "criada")?.titulo).toContain("repetição");
  });
});
