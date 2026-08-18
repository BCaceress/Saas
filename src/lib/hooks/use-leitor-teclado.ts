"use client";

import * as React from "react";

// ============================================================
// Leitor de código de barras USB / Bluetooth.
//
// Esses leitores não têm API: eles se apresentam como TECLADO e "digitam" o
// código seguido de Enter, muito mais rápido do que qualquer humano. Então a
// detecção é pelo ritmo — várias teclas com intervalo curtíssimo e um Enter no
// fim é bipe; digitação normal não é.
//
// Não exige campo focado de propósito: na conferência, o operador segura o
// leitor numa mão e a caixa na outra. Clicar num input antes de cada bipe
// seria o mesmo atrito que a funcionalidade existe para tirar.
// ============================================================

/** Intervalo máximo entre teclas para o burst ainda contar como leitura. */
const INTERVALO_MAX_MS = 60;
/** Códigos curtos demais são digitação — não vale arriscar um falso positivo. */
const TAMANHO_MIN = 4;

function ehCampoDeTexto(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function useLeitorTeclado(
  onCodigo: (codigo: string) => void,
  opcoes: { ativo?: boolean } = {},
) {
  const ativo = opcoes.ativo ?? true;
  // O listener é registrado uma vez; a ref mantém ele enxergando o callback
  // atual sem religar o evento a cada render.
  const callback = React.useRef(onCodigo);
  React.useEffect(() => {
    callback.current = onCodigo;
  }, [onCodigo]);

  React.useEffect(() => {
    if (!ativo) return;

    let buffer = "";
    let ultima = 0;

    function onKeyDown(e: KeyboardEvent) {
      // Enquanto o operador digita numa quantidade ou num lote, o teclado é
      // dele: só o leitor "digita" rápido o bastante para chegar aqui.
      if (ehCampoDeTexto(e.target) && buffer.length === 0) return;

      const agora = Date.now();
      if (agora - ultima > INTERVALO_MAX_MS) buffer = "";
      ultima = agora;

      if (e.key === "Enter") {
        const codigo = buffer.trim();
        buffer = "";
        if (codigo.length >= TAMANHO_MIN) {
          e.preventDefault();
          callback.current(codigo);
        }
        return;
      }

      if (e.key.length === 1) buffer += e.key;
      else if (e.key !== "Shift") buffer = "";
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [ativo]);
}
