import "server-only";
import { WhatsAppProviderError, type WhatsAppProvider } from "./types";

// Provedor de desenvolvimento: nada sai do servidor. Existe para o fluxo da
// tela ser exercitado inteiro (fila, status, trilha) sem conta na Meta e sem
// gastar mensagem paga. O `wamid` falso segue o formato do real para o webhook
// simulado poder casar com a linha da trilha.

export function simuladoProvider(): WhatsAppProvider {
  return {
    kind: "SIMULADO",

    async enviarTemplate(envio) {
      if (!envio.para) {
        throw new WhatsAppProviderError("Contato sem número de WhatsApp.", true);
      }
      return {
        externalId: `wamid.SIMULADO-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      };
    },

    async validarCredenciais() {
      // Sempre válido: é o ponto do simulado.
    },
  };
}
