// Preload — a única ponte entre o renderer (React do PDV) e o processo nativo.
// Expõe `window.tef` implementando o TefBridge (src/lib/tef/ipc.ts). Com
// contextIsolation, o renderer NÃO tem acesso a Node/Electron: só a este objeto.

const { contextBridge, ipcRenderer } = require("electron");
const { TEF_IPC } = require("./tef-channels");

contextBridge.exposeInMainWorld("tef", {
  pagar: (input) => ipcRenderer.invoke(TEF_IPC.pagar, input),
  confirmar: (tefId) => ipcRenderer.invoke(TEF_IPC.confirmar, tefId),
  desfazer: (tefId) => ipcRenderer.invoke(TEF_IPC.desfazer, tefId),
  cancelar: (tefId, valor) => ipcRenderer.invoke(TEF_IPC.cancelar, tefId, valor),
});
