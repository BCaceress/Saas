"use client";

import * as React from "react";
import { Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { Button } from "@/components/ui/button";

// ============================================================
// Ditado — o segundo canal de entrada, para quando a mão está ocupada.
//
// Usa a API de reconhecimento do próprio navegador (SpeechRecognition): o áudio
// não passa pelo nosso servidor e não gera custo por segundo falado. O que vai
// para o servidor é só a TRANSCRIÇÃO, e mesmo ela nunca vira escrita direta —
// `interpretarComandoAction` devolve uma intenção que abre a sheet de sempre,
// com o botão de confirmar. Reconhecimento de fala troca "três" por "treze"; o
// saldo do estoque não pode depender disso.
//
// Sem suporte (Firefox, alguns Android), o botão simplesmente não aparece: é
// um atalho, não um caminho único.
// ============================================================

type ReconhecimentoLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};

/**
 * A checagem de suporte toca em `window`, então não pode acontecer no render do
 * servidor. `useSyncExternalStore` com um snapshot de servidor fixo resolve sem
 * efeito nem `setState`: o servidor renderiza sem botão, o cliente decide na
 * hidratação. O resultado é memorizado — construir o reconhecedor a cada render
 * seria desperdício.
 */
let suporteConhecido: boolean | null = null;

function temSuporte(): boolean {
  if (suporteConhecido === null) suporteConhecido = criarReconhecimento() !== null;
  return suporteConhecido;
}

/** Suporte não muda durante a sessão: nada a assinar. */
function semAssinatura(): () => void {
  return () => {};
}

function semSuporteNoServidor(): boolean {
  return false;
}

function criarReconhecimento(): ReconhecimentoLike | null {
  const g = globalThis as unknown as {
    SpeechRecognition?: new () => ReconhecimentoLike;
    webkitSpeechRecognition?: new () => ReconhecimentoLike;
  };
  const Classe = g.SpeechRecognition ?? g.webkitSpeechRecognition;
  if (!Classe) return null;
  const r = new Classe();
  r.lang = "pt-BR";
  r.continuous = false;
  r.interimResults = true;
  return r;
}

export function BotaoDitado({
  onTexto,
  className,
}: {
  /** Recebe a transcrição final. Só dispara com algo dito. */
  onTexto: (texto: string) => void;
  className?: string;
}) {
  const suportado = React.useSyncExternalStore(
    semAssinatura,
    temSuporte,
    semSuporteNoServidor,
  );
  const [ouvindo, setOuvindo] = React.useState(false);
  const [parcial, setParcial] = React.useState("");
  const refReco = React.useRef<ReconhecimentoLike | null>(null);
  const refTexto = React.useRef("");

  const parar = React.useCallback(() => {
    refReco.current?.stop();
    refReco.current = null;
    setOuvindo(false);
  }, []);

  function ouvir() {
    const reco = criarReconhecimento();
    if (!reco) return;

    refTexto.current = "";
    setParcial("");
    setOuvindo(true);

    reco.onresult = (e) => {
      let texto = "";
      for (let i = 0; i < e.results.length; i += 1) {
        texto += e.results[i][0]?.transcript ?? "";
      }
      refTexto.current = texto;
      setParcial(texto);
    };
    reco.onerror = () => {
      refReco.current = null;
      setOuvindo(false);
    };
    reco.onend = () => {
      refReco.current = null;
      setOuvindo(false);
      const dito = refTexto.current.trim();
      if (dito) onTexto(dito);
    };

    refReco.current = reco;
    reco.start();
  }

  if (!suportado) return null;

  return (
    <>
      <button
        type="button"
        onClick={ouvir}
        aria-label="Falar um comando"
        className={cn(
          "grid min-h-12 w-12 cursor-pointer place-items-center rounded-full border border-line-button bg-surface text-ink-2",
          "active:bg-surface-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
          className,
        )}
      >
        <Mic className="h-5 w-5" aria-hidden />
      </button>

      <BottomSheet
        open={ouvindo}
        onClose={parar}
        titulo="Estou ouvindo"
        descricao='Diga o que aconteceu — "quebrou três Monster", "muda o preço da Coca para 8,90".'
        rodape={
          <Button variant="secondary" onClick={parar} className="w-full" size="lg">
            <Square className="h-4 w-4" aria-hidden />
            Parar
          </Button>
        }
      >
        <div className="flex min-h-28 items-center justify-center px-2 pb-2 text-center">
          <p className={cn("text-lg", parcial ? "text-ink" : "text-faint")}>
            {parcial || "…"}
          </p>
        </div>
      </BottomSheet>
    </>
  );
}
