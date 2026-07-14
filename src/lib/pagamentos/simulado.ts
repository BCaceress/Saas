import "server-only";
import type { PagamentoProvider, StatusCobranca } from "./types";

// ============================================================
// Provedor SIMULADO — desenvolvimento/demonstração sem conta em PSP.
// Sem estado: o timestamp de criação vai embutido no externalId e a
// cobrança "aprova sozinha" depois de alguns segundos.
// ============================================================

const PIX_APROVA_MS = 10_000;
const CARTAO_APROVA_MS = 7_000;

function statusPorIdade(externalId: string, aprovaMs: number): StatusCobranca {
  const ts = Number(externalId.split("_").pop());
  if (!Number.isFinite(ts)) return "PENDENTE";
  return Date.now() - ts >= aprovaMs ? "CONFIRMADO" : "PENDENTE";
}

export function simuladoProvider(): PagamentoProvider {
  return {
    slug: "SIMULADO",
    suportaCartaoIntegrado: true,

    async criarCobrancaPix(input) {
      const externalId = `sim_pix_${Date.now()}`;
      return {
        externalId,
        // payload fictício — dá para testar o botão "copiar" sem PSP real
        copiaECola: `00020126580014BR.GOV.BCB.PIX-SIMULADO-${input.referencia}-${input.valor.toFixed(2)}`,
        qrCodeBase64: null,
        expiraEm: new Date(Date.now() + 15 * 60 * 1000),
      };
    },
    async consultarCobranca(externalId) {
      return statusPorIdade(externalId, PIX_APROVA_MS);
    },
    async cancelarCobranca() {},

    async listarTerminais() {
      return [
        {
          externalId: "SIM-TERMINAL-01",
          nome: "Maquininha simulada",
          operatingMode: "PDV",
        },
      ];
    },
    async prepararTerminal() {},
    async criarIntencaoCartao() {
      return { externalId: `sim_card_${Date.now()}` };
    },
    async consultarIntencao(externalId) {
      const s = statusPorIdade(externalId, CARTAO_APROVA_MS);
      return s === "PENDENTE" ? "PROCESSANDO" : s;
    },
    async cancelarIntencao() {},
  };
}
