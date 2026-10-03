import { describe, expect, it } from "vitest";
import { decidirEnvio, type EntradaAvisoEnvio } from "@/lib/compras/conclusao-envio";

// Sugerir "enviar agora" num pedido que precisava de ajuste é exatamente o
// erro que a regra de 31/08 evitava (prometer sem ler). Cada aviso aqui é um
// motivo real para o operador olhar o rascunho antes.

const limpo: EntradaAvisoEnvio = {
  itensForaDoCatalogo: 0,
  itensAcimaDoCotado: 0,
  itensComMarcaDivergente: 0,
  total: 2000,
  pedidoMinimo: 1500,
  respostaManual: false,
  prazoDesconhecido: false,
  temContato: true,
  jaTemPedido: false,
};

describe("decidirEnvio", () => {
  it("pedido limpo sugere enviar", () => {
    expect(decidirEnvio(limpo)).toEqual({ bloqueio: null, avisos: [], sugestao: "enviar" });
  });

  it.each<[string, Partial<EntradaAvisoEnvio>]>([
    ["item fora do catálogo", { itensForaDoCatalogo: 1 }],
    ["abaixo do mínimo", { total: 1000 }],
    ["acima do cotado", { itensAcimaDoCotado: 2 }],
    ["marca divergente", { itensComMarcaDivergente: 1 }],
    ["resposta manual", { respostaManual: true }],
    ["prazo desconhecido", { prazoDesconhecido: true }],
  ])("%s sugere revisar, sem bloquear", (_, mudanca) => {
    const r = decidirEnvio({ ...limpo, ...mudanca });
    expect(r.sugestao).toBe("revisar");
    expect(r.bloqueio).toBeNull();
    expect(r.avisos).toHaveLength(1);
  });

  it("sem pedido mínimo cadastrado não avisa", () => {
    expect(decidirEnvio({ ...limpo, pedidoMinimo: null, total: 1 }).avisos).toEqual([]);
  });

  it("sem contato bloqueia", () => {
    const r = decidirEnvio({ ...limpo, temContato: false });
    expect(r.bloqueio).not.toBeNull();
    expect(r.sugestao).toBe("revisar");
  });

  it("já tem pedido bloqueia e cala os avisos", () => {
    const r = decidirEnvio({ ...limpo, jaTemPedido: true, respostaManual: true });
    expect(r.bloqueio).toContain("Já existe pedido");
    expect(r.avisos).toEqual([]);
  });

  it("junta vários avisos no plural", () => {
    const r = decidirEnvio({ ...limpo, itensForaDoCatalogo: 2, itensAcimaDoCotado: 1 });
    expect(r.avisos).toEqual([
      "2 itens ficam fora (sem produto no catálogo)",
      "1 item vai acima da quantidade cotada",
    ]);
  });
});
