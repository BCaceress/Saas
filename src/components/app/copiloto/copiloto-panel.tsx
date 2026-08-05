"use client";

import * as React from "react";
import { Send, Sparkles, Trash2 } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { CopilotoMensagem } from "./copiloto-mensagem";
import { useCopilotoChat } from "./use-copiloto-chat";

const SUGESTOES = [
  "Como estão minhas vendas hoje?",
  "Quanto tenho de estoque parado?",
  "Qual fornecedor está mais barato?",
  "Gerar relatório de vendas do mês",
];

export function CopilotoPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { mensagens, enviar, enviando, limpar } = useCopilotoChat();
  const [texto, setTexto] = React.useState("");
  const fimRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [mensagens]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pergunta = texto.trim();
    if (!pergunta || enviando) return;
    setTexto("");
    void enviar(pergunta);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="NoHub IA"
      description="Pergunte sobre vendas, estoque, compras e relatórios."
      width="md"
      headerActions={
        mensagens.length > 0 ? (
          <button
            type="button"
            onClick={limpar}
            aria-label="Limpar conversa"
            className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Trash2 size={16} />
          </button>
        ) : null
      }
      footer={
        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Pergunte algo…"
            aria-label="Pergunte ao NoHub IA"
            maxLength={400}
            disabled={enviando}
            className="h-10 flex-1 rounded-full border border-line bg-surface px-4 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
          <button
            type="submit"
            disabled={enviando || texto.trim().length === 0}
            aria-label="Enviar pergunta"
            className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full bg-brand text-on-brand transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send size={16} />
          </button>
        </form>
      }
    >
      {mensagens.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand">
            <Sparkles size={20} />
          </span>
          <div>
            <p className="font-display text-base font-semibold text-ink">NoHub IA</p>
            <p className="mt-1 text-sm text-muted">
              Pergunte sobre vendas, estoque, compras e relatórios.
            </p>
          </div>
          <div className="flex w-full flex-col gap-1.5">
            {SUGESTOES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void enviar(s)}
                className="cursor-pointer rounded-xl border border-line px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-2"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {mensagens.map((m) => (
            <CopilotoMensagem key={m.id} mensagem={m} />
          ))}
          <div ref={fimRef} />
        </div>
      )}
    </Sheet>
  );
}
