"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Painel que sobe de baixo. É o `Sheet` de `ui/sheet.tsx` virado para o
 * celular: aquele entra pela direita e vive num `max-w-md` que, numa tela de
 * 390px, é a tela inteira entrando de lado — gesto que ninguém faz no telefone.
 *
 * Regras que o formato impõe:
 *  · `max-h-[85dvh]` deixa ver o que ficou atrás, então a pessoa não perde o
 *    contexto do que estava fazendo;
 *  · o rodapé de ação fica FIXO, com área segura — o botão de confirmar não
 *    pode depender de rolar até o fim;
 *  · a alça no topo é só sinal visual: fechar é pelo X ou pelo fundo.
 */
export function BottomSheet({
  open,
  onClose,
  titulo,
  descricao,
  children,
  rodape,
}: {
  open: boolean;
  onClose: () => void;
  titulo: string;
  descricao?: React.ReactNode;
  children: React.ReactNode;
  rodape?: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    // Trava o fundo: sem isso, rolar dentro do painel arrasta a página atrás.
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
    >
      <div
        className="absolute inset-0 animate-[fade_120ms_ease-out] bg-ink/40"
        onClick={onClose}
        aria-hidden
      />

      <div
        className={cn(
          "relative flex max-h-[85dvh] w-full flex-col rounded-t-[var(--radius-xl)] bg-surface shadow-[var(--shadow-2)]",
          "animate-[subir_180ms_cubic-bezier(0.22,1,0.36,1)]",
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong" aria-hidden />

        <header className="flex items-start justify-between gap-3 px-4 pt-2 pb-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-ink">{titulo}</h2>
            {descricao && <div className="mt-0.5 text-sm text-muted">{descricao}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">{children}</div>

        {rodape && (
          <footer className="shrink-0 border-t border-line px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {rodape}
          </footer>
        )}
      </div>

      <style>{`
        @keyframes subir { from { transform: translateY(24px); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[subir_180ms_cubic-bezier\\(0\\.22\\,1\\,0\\.36\\,1\\)\\],
          .animate-\\[fade_120ms_ease-out\\] { animation: none !important }
        }
      `}</style>
    </div>
  );
}
