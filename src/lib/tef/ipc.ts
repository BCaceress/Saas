import type { TefResultado, TefTipoCartao, TefParcelamento } from "./types";

// ============================================================
// Ponte TEF renderer ↔ processo nativo (Electron main / agente local).
//
// O React do PDV roda no renderer e NÃO alcança o pinpad. O Electron expõe, via
// `contextBridge` no preload, um objeto `window.tef` que encaminha as chamadas
// por IPC ao main, onde o adapter TEF (PayGo/SiTef) driva o pinpad de verdade.
//
// Este arquivo é a fronteira TIPADA que os dois lados compartilham: o preload
// implementa `TefBridge`, o PDV consome. Assim o renderer não conhece Electron —
// só `window.tef`.
//
// FORA DO ELECTRON (dev no navegador, ou PDV web sem TEF): `window.tef` é
// `undefined`. O PDV detecta com `tefDisponivel()` e esconde o cartão TEF,
// caindo no cartão via PSP (nuvem) ou no recebimento manual.
// ============================================================

export type TefPagarInput = {
  valor: number;
  tipo: TefTipoCartao;
  parcelas?: number;
  parcelamento?: TefParcelamento;
  referencia: string;
};

/** O que o preload do Electron expõe em `window.tef`. */
export interface TefBridge {
  pagar(input: TefPagarInput): Promise<TefResultado>;
  confirmar(tefId: string): Promise<void>;
  desfazer(tefId: string): Promise<void>;
  cancelar(tefId: string, valor: number): Promise<TefResultado>;
}

declare global {
  interface Window {
    tef?: TefBridge;
  }
}

/** TEF só existe quando o PDV roda dentro do runtime nativo (Electron). */
export function tefDisponivel(): boolean {
  return typeof window !== "undefined" && !!window.tef;
}

/** Acesso seguro à ponte — lança se chamado sem runtime nativo. */
export function tefBridge(): TefBridge {
  if (typeof window === "undefined" || !window.tef) {
    throw new Error("TEF indisponível — o PDV precisa rodar no aplicativo (Electron).");
  }
  return window.tef;
}

/** Canais IPC (usados pelo preload e pelo main; não pelo renderer direto). */
export const TEF_IPC = {
  pagar: "tef:pagar",
  confirmar: "tef:confirmar",
  desfazer: "tef:desfazer",
  cancelar: "tef:cancelar",
} as const;
