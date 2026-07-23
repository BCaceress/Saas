// TEF simulado (CJS) para o processo Electron — Fase 1, sem pinpad nem contrato.
// Espelha src/lib/tef/simulado.ts. Aprova sempre e devolve comprovante fictício.
// Na Fase 2 este arquivo dá lugar ao adapter real (PayGo/SiTef), implementando
// o mesmo contrato (pagar/confirmar/desfazer/cancelar).

let contador = 1000;

function tefSimulado() {
  return {
    async pagar(input) {
      const nsu = String(contador++);
      const via = (t) =>
        `--- ${t} ---\nSIMULADO TEF\n${input.tipo} ${input.parcelas || 1}x\n` +
        `R$ ${Number(input.valor).toFixed(2)}\nNSU ${nsu}  AUT 123456\nVenda ${input.referencia}`;
      return {
        status: "APROVADO",
        bandeira: "MASTERCARD",
        parcelas: input.parcelas || 1,
        nsu,
        autorizacao: "123456",
        adquirente: "SIMULADO",
        adquirenteCnpj: null,
        comprovanteCliente: via("VIA CLIENTE"),
        comprovanteLoja: via("VIA LOJA"),
        tefId: `sim_tef_${nsu}`,
      };
    },

    async confirmar() {},
    async desfazer() {},

    async cancelar(input) {
      return {
        status: "APROVADO",
        bandeira: null,
        parcelas: null,
        nsu: null,
        autorizacao: null,
        adquirente: "SIMULADO",
        adquirenteCnpj: null,
        comprovanteCliente: `--- CANCELAMENTO ---\nTEF ${input.tefId}\nR$ ${Number(input.valor).toFixed(2)}`,
        comprovanteLoja: null,
        tefId: input.tefId,
      };
    },

    async resolverPendencias() {},
  };
}

module.exports = { tefSimulado };
