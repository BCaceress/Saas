import type { TefProvider, TefResultado } from "./types";

// ============================================================
// Gerenciador TEF SIMULADO — desenvolvimento e testes sem pinpad nem contrato.
// Aprova sempre, devolve dados fictícios de comprovante/conciliação. Espelha o
// simulado do Payment Service (src/lib/pagamentos/simulado.ts).
//
// Diferente dos adapters reais, ESTE pode rodar em qualquer lugar (não toca
// hardware) — serve para exercitar o fluxo dois-fases e a NFC-e com grupo card
// sem sair da máquina de dev.
// ============================================================

let contador = 1000;

export function tefSimuladoProvider(): TefProvider {
  return {
    slug: "SIMULADO",

    async pagar(input): Promise<TefResultado> {
      const nsu = String(contador++);
      const linha = (t: string) =>
        `--- ${t} ---\nSIMULADO TEF\n${input.tipo} ${input.parcelas ?? 1}x\n` +
        `R$ ${input.valor.toFixed(2)}\nNSU ${nsu}  AUT 123456\nVenda ${input.referencia}`;
      return {
        status: "APROVADO",
        bandeira: "MASTERCARD",
        parcelas: input.parcelas ?? 1,
        nsu,
        autorizacao: "123456",
        adquirente: "SIMULADO",
        adquirenteCnpj: null,
        comprovanteCliente: linha("VIA CLIENTE"),
        comprovanteLoja: linha("VIA LOJA"),
        tefId: `sim_tef_${nsu}`,
      };
    },

    async confirmar() {},
    async desfazer() {},

    async cancelar(input): Promise<TefResultado> {
      return {
        status: "APROVADO",
        bandeira: null,
        parcelas: null,
        nsu: null,
        autorizacao: null,
        adquirente: "SIMULADO",
        adquirenteCnpj: null,
        comprovanteCliente: `--- CANCELAMENTO ---\nTEF ${input.tefId}\nR$ ${input.valor.toFixed(2)}`,
        comprovanteLoja: null,
        tefId: input.tefId,
      };
    },

    async resolverPendencias() {},
  };
}
