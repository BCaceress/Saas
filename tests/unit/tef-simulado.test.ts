import { describe, it, expect } from "vitest";
import { tefSimuladoProvider } from "@/lib/tef/simulado";
import { BANDEIRAS } from "@/lib/pagamentos/types";

// O simulado é o que permite testar o fluxo TEF (dois-fases) sem pinpad. Estes
// testes travam o CONTRATO: forma do resultado aprovado + operações chamáveis.
describe("tefSimuladoProvider", () => {
  const tef = tefSimuladoProvider();

  it("pagar aprova e devolve os campos que a NFC-e/conciliação precisam", async () => {
    const r = await tef.pagar({
      valor: 42.9,
      tipo: "CREDITO",
      parcelas: 3,
      referencia: "#TESTE",
    });
    expect(r.status).toBe("APROVADO");
    expect(r.tefId).toBeTruthy();
    expect(r.nsu).toBeTruthy();
    expect(r.autorizacao).toBeTruthy();
    expect(r.parcelas).toBe(3);
    expect(r.bandeira && (BANDEIRAS as readonly string[]).includes(r.bandeira)).toBe(true);
    expect(r.comprovanteCliente).toContain("R$ 42.90");
  });

  it("gera NSU/tefId distintos por transação", async () => {
    const a = await tef.pagar({ valor: 10, tipo: "DEBITO", referencia: "a" });
    const b = await tef.pagar({ valor: 10, tipo: "DEBITO", referencia: "b" });
    expect(a.tefId).not.toBe(b.tefId);
    expect(a.nsu).not.toBe(b.nsu);
  });

  it("confirmar/desfazer/cancelar são chamáveis (2ª fase)", async () => {
    const r = await tef.pagar({ valor: 5, tipo: "DEBITO", referencia: "x" });
    await expect(tef.confirmar({ tefId: r.tefId! })).resolves.toBeUndefined();
    await expect(tef.desfazer({ tefId: r.tefId! })).resolves.toBeUndefined();
    const c = await tef.cancelar({ tefId: r.tefId!, valor: 5 });
    expect(c.status).toBe("APROVADO");
  });
});
