// Processo principal do PDV desktop (Electron) — Fase 1.
//
// Faz duas coisas que o navegador não faz:
//   1. Hospeda o adapter TEF (aqui, o simulado) e o expõe ao renderer por IPC.
//   2. Roda o app num runtime nativo — base do offline (servidor local) na Fase 3.
//
// Nesta fase carrega o app Next JÁ SERVIDO (dev server ou `next start`). Embutir
// o Next standalone dentro do executável é passo posterior da Fase 1/3.

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { tefSimulado } = require("./tef-simulado");
const { TEF_IPC } = require("./tef-channels");

// URL do app. Em dev, o Next dev server; em prod (por ora) um start local.
const APP_URL = process.env.PDV_URL || "http://localhost:3000/vendas";

// Adapter TEF ativo. Trocar por PayGo/SiTef na Fase 2 (mesmo contrato).
const tef = tefSimulado();

function registrarTef() {
  ipcMain.handle(TEF_IPC.pagar, (_e, input) => tef.pagar(input));
  ipcMain.handle(TEF_IPC.confirmar, (_e, tefId) => tef.confirmar({ tefId }));
  ipcMain.handle(TEF_IPC.desfazer, (_e, tefId) => tef.desfazer({ tefId }));
  ipcMain.handle(TEF_IPC.cancelar, (_e, tefId, valor) => tef.cancelar({ tefId, valor }));
}

async function criarJanela() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    backgroundColor: "#16181d",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, // renderer não vê Node — só a ponte do preload
      nodeIntegration: false,
    },
  });

  await win.loadURL(APP_URL);
  if (!app.isPackaged) win.webContents.openDevTools({ mode: "detach" });
}

app.whenReady().then(() => {
  registrarTef();
  criarJanela();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
