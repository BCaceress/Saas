// Canais IPC do TEF — ESPELHO de `src/lib/tef/ipc.ts` (TEF_IPC).
// Mantidos idênticos dos dois lados: o renderer usa a versão TS, o main/preload
// usa esta (CJS). Se mudar um, mude o outro.
const TEF_IPC = {
  pagar: "tef:pagar",
  confirmar: "tef:confirmar",
  desfazer: "tef:desfazer",
  cancelar: "tef:cancelar",
};

module.exports = { TEF_IPC };
