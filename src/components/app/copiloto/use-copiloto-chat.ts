"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

export type CopilotoMensagemUI = {
  id: string;
  role: "user" | "assistant";
  texto: string;
  status: "pendente" | "streaming" | "pronta" | "erro";
  toolAtual: string | null;
};

type EventoSse =
  | { tipo: "texto"; texto: string }
  | { tipo: "tool-inicio"; nome: string }
  | { tipo: "tool-fim"; nome: string; ok: boolean }
  | { tipo: "fim" }
  | { tipo: "erro"; mensagem: string };

function novoId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Chat client-side: envia pergunta + histórico truncado + página atual pro
 * `/api/copiloto/chat`, faz parse manual do SSE (sem `EventSource`, que só
 * suporta GET) e vai atualizando a mensagem do assistente incrementalmente.
 * Memória fica só no estado do componente — reload ou fechar o painel perde o
 * histórico, é o mínimo viável da Fase 1.
 */
export function useCopilotoChat() {
  const pathname = usePathname();
  const [mensagens, setMensagens] = React.useState<CopilotoMensagemUI[]>([]);
  const [enviando, setEnviando] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  const atualizarMensagem = React.useCallback(
    (id: string, atualizar: (m: CopilotoMensagemUI) => CopilotoMensagemUI) => {
      setMensagens((prev) => prev.map((m) => (m.id === id ? atualizar(m) : m)));
    },
    [],
  );

  const enviar = React.useCallback(
    async (pergunta: string) => {
      const texto = pergunta.trim();
      if (!texto || enviando) return;

      const historico = mensagens
        .filter((m) => m.texto.length > 0)
        .map((m) => ({ role: m.role, content: m.texto }));

      const idAssistente = novoId();
      setMensagens((prev) => [
        ...prev,
        { id: novoId(), role: "user", texto, status: "pronta", toolAtual: null },
        { id: idAssistente, role: "assistant", texto: "", status: "streaming", toolAtual: null },
      ]);
      setEnviando(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/copiloto/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pergunta: texto,
            historico,
            contexto: { pagina: pathname ?? "" },
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const msg = await res.text().catch(() => "");
          throw new Error(msg || "Não consegui falar com o copiloto agora.");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const partes = buffer.split("\n\n");
          buffer = partes.pop() ?? "";

          for (const parte of partes) {
            const linhaDados = parte.split("\n").find((l) => l.startsWith("data: "));
            if (!linhaDados) continue;
            let evento: EventoSse;
            try {
              evento = JSON.parse(linhaDados.slice(6)) as EventoSse;
            } catch {
              continue;
            }

            if (evento.tipo === "texto") {
              atualizarMensagem(idAssistente, (m) => ({
                ...m,
                texto: m.texto + evento.texto,
                status: "streaming",
              }));
            } else if (evento.tipo === "tool-inicio") {
              atualizarMensagem(idAssistente, (m) => ({ ...m, toolAtual: evento.nome }));
            } else if (evento.tipo === "tool-fim") {
              atualizarMensagem(idAssistente, (m) => ({ ...m, toolAtual: null }));
            } else if (evento.tipo === "fim") {
              atualizarMensagem(idAssistente, (m) => ({ ...m, status: "pronta", toolAtual: null }));
            } else if (evento.tipo === "erro") {
              atualizarMensagem(idAssistente, (m) => ({
                ...m,
                status: "erro",
                texto: m.texto || evento.mensagem,
                toolAtual: null,
              }));
            }
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        const msg = e instanceof Error ? e.message : "Não consegui responder agora. Tente de novo.";
        atualizarMensagem(idAssistente, (m) => ({
          ...m,
          status: "erro",
          texto: m.texto || msg,
          toolAtual: null,
        }));
      } finally {
        setEnviando(false);
        abortRef.current = null;
      }
    },
    [mensagens, enviando, pathname, atualizarMensagem],
  );

  const limpar = React.useCallback(() => {
    abortRef.current?.abort();
    setMensagens([]);
  }, []);

  return { mensagens, enviar, enviando, limpar };
}
