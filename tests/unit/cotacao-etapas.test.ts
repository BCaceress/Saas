import { describe, expect, it } from "vitest";
import { etapasDaCotacao } from "@/app/(app)/cotacoes/_etapas";

type S = "PENDENTE" | "ENVIADA" | "RESPONDIDA" | "RECUSADA";
const conv = (...s: S[]) => s.map((status) => ({ status }));
const estados = (e: ReturnType<typeof etapasDaCotacao>) => e.map((x) => x.estado);

describe("etapasDaCotacao", () => {
  it("aberta sem todas as respostas: etapa atual é Respostas", () => {
    const e = etapasDaCotacao("ABERTA", conv("RESPONDIDA", "ENVIADA", "ENVIADA"), []);
    expect(estados(e)).toEqual(["feito", "atual", "futuro", "futuro"]);
    expect(e[1].detalhe).toBe("1 de 3");
  });

  it("todos responderam (recusa conta como fechada): etapa atual é Decisão", () => {
    const e = etapasDaCotacao("ABERTA", conv("RESPONDIDA", "RECUSADA"), []);
    expect(estados(e)).toEqual(["feito", "feito", "atual", "futuro"]);
  });

  it("encerrada: decisão, mesmo com gente faltando", () => {
    const e = etapasDaCotacao("ENCERRADA", conv("RESPONDIDA", "ENVIADA"), []);
    expect(e[2].estado).toBe("atual");
  });

  it("concluída com pedido em rascunho: Pedidos é a etapa atual", () => {
    const e = etapasDaCotacao("DECIDIDA", conv("RESPONDIDA"), [{ status: "RASCUNHO" }]);
    expect(estados(e)).toEqual(["feito", "feito", "feito", "atual"]);
    expect(e[3].detalhe).toBe("1 a enviar");
  });

  it("concluída com todos os pedidos enviados: tudo feito", () => {
    const e = etapasDaCotacao("DECIDIDA", conv("RESPONDIDA"), [
      { status: "ENVIADO" },
      { status: "CANCELADO" },
    ]);
    expect(estados(e)).toEqual(["feito", "feito", "feito", "feito"]);
    expect(e[3].detalhe).toBe("1 enviado");
  });

  it("aponta convite ainda não enviado", () => {
    const e = etapasDaCotacao("ABERTA", conv("PENDENTE", "ENVIADA"), []);
    expect(e[0].detalhe).toBe("1 a enviar");
  });
});
