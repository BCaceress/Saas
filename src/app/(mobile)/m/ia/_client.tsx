"use client";

import * as React from "react";
import { Send, Sparkles, Trash2 } from "lucide-react";
import { CopilotoMensagem } from "@/components/app/copiloto/copiloto-mensagem";
import { useCopilotoChat } from "@/components/app/copiloto/use-copiloto-chat";

const SUGESTOES = [
  "Como estão minhas vendas hoje?",
  "Quanto tenho de estoque parado?",
  "Qual fornecedor está mais barato?",
  "Gerar relatório de vendas do mês",
];

/**
 * Conversa com o copiloto no celular.
 *
 * Mesmo motor do painel de mesa (`useCopilotoChat` + `CopilotoMensagem`), outra
 * moldura: aqui não há `Sheet`, o documento rola normalmente e o campo de
 * pergunta fica fixo acima da barra de abas — é o polegar que escreve.
 *
 * A memória continua sendo só o estado deste componente: sair da tela apaga a
 * conversa, igual ao desktop.
 */
export function IaClient() {
  const { mensagens, enviar, enviando, limpar } = useCopilotoChat();
  const [texto, setTexto] = React.useState("");
  const fimRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [mensagens]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pergunta = texto.trim();
    if (!pergunta || enviando) return;
    setTexto("");
    void enviar(pergunta);
  }

  return (
    // O respiro embaixo é a soma do campo fixo (~3.5rem) com a barra de abas
    // flutuante: sem ele a última resposta nasce escondida.
    <div className="pb-28">
      {mensagens.length === 0 ? (
        <div className="flex flex-col items-center gap-4 pt-6 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand">
            <Sparkles size={20} aria-hidden />
          </span>
          <p className="text-sm text-ink-2">
            Pergunte com suas palavras. Eu consulto os dados da sua loja e
            respondo com o número, não com o caminho até ele.
          </p>
          <div className="flex w-full flex-col gap-1.5">
            {SUGESTOES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void enviar(s)}
                className="min-h-12 cursor-pointer rounded-xl border border-line bg-surface px-3 py-2 text-left text-sm text-ink hover:bg-surface-2"
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

          <button
            type="button"
            onClick={limpar}
            className="mx-auto inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-4 text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-ink"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Limpar conversa
          </button>
        </div>
      )}

      {/* Fixo acima da barra de abas do shell (4rem + respiro + área segura),
          mesma altura da barra da contagem. */}
      <form
        onSubmit={onSubmit}
        className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-30 flex items-center gap-2 rounded-full border border-line bg-surface p-1.5 pl-4 shadow-[var(--shadow-2)]"
      >
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Pergunte algo…"
          aria-label="Pergunte ao NoHub IA"
          maxLength={400}
          disabled={enviando}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-faint focus:outline-none"
        />
        <button
          type="submit"
          disabled={enviando || texto.trim().length === 0}
          aria-label="Enviar pergunta"
          className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full bg-brand text-on-brand disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send size={16} aria-hidden />
        </button>
      </form>
    </div>
  );
}
