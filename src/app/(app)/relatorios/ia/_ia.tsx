"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import {
  Sparkles,
  ArrowUp,
  Lightbulb,
  TriangleAlert,
  Trash2,
  User,
  Mic,
  MicOff,
} from "lucide-react";
import { perguntarIA } from "./actions";
import type { ResultadoIA } from "./_schema";
import { cn } from "@/lib/utils";

const SUGESTOES = [
  "Top 10 produtos mais vendidos em 30 dias",
  "Produtos com margem abaixo de 20%",
  "Quanto vendi por método de pagamento este mês",
  "Maiores perdas por custo nos últimos 7 dias",
  "Curva ABC do faturamento do mês",
  "Produtos parados com mais valor em estoque",
  "Receita por categoria este mês",
  "Compras por fornecedor nos últimos 30 dias",
];

type Mensagem =
  | { tipo: "pergunta"; texto: string }
  | { tipo: "resposta"; resultado: ResultadoIA }
  | { tipo: "erro"; texto: string };

export function RelatorioIA() {
  const [pergunta, setPergunta] = useState("");
  const [historico, setHistorico] = useState<Mensagem[]>([]);
  const [pending, start] = useTransition();
  const [gravando, setGravando] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [historico, pending]);

  function enviar(texto: string) {
    const q = texto.trim();
    if (!q || pending) return;
    setPergunta("");
    setHistorico((h) => [...h, { tipo: "pergunta", texto: q }]);
    start(async () => {
      const r = await perguntarIA(q);
      if ("erro" in r) {
        setHistorico((h) => [...h, { tipo: "erro", texto: r.erro }]);
      } else {
        setHistorico((h) => [...h, { tipo: "resposta", resultado: r }]);
      }
    });
  }

  function limpar() {
    setHistorico([]);
    setPergunta("");
    inputRef.current?.focus();
  }

  function toggleVoz() {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechAPI) {
      alert("Seu navegador não suporta reconhecimento de voz. Use Chrome ou Edge.");
      return;
    }

    if (gravando && recognitionRef.current) {
      recognitionRef.current.stop();
      setGravando(false);
      return;
    }

    const rec = new SpeechAPI();
    rec.lang = "pt-BR";
    rec.continuous = false;
    rec.interimResults = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (event: any) => {
      const texto: string = event.results[0][0].transcript;
      setPergunta((prev) => (prev ? `${prev} ${texto}` : texto));
      setGravando(false);
    };
    rec.onerror = () => setGravando(false);
    rec.onend = () => setGravando(false);

    recognitionRef.current = rec;
    rec.start();
    setGravando(true);
  }

  const vazio = historico.length === 0 && !pending;

  return (
    <div className="flex flex-col gap-6">
      {/* Empty state / suggestions */}
      {vazio && (
        <div className="space-y-6 py-4">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-lg bg-brand-softer text-brand">
              <Sparkles size={24} aria-hidden />
            </div>
            <div>
              <p className="font-display text-lg font-bold text-ink">Assistente de análises</p>
              <p className="mt-1 text-sm text-muted">
                Pergunte sobre suas vendas, estoque, margem ou perdas em português.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            {SUGESTOES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => enviar(s)}
                className="cursor-pointer rounded-full border border-line bg-surface px-3.5 py-2 text-sm text-muted transition-colors hover:border-brand/40 hover:bg-brand-soft hover:text-ink"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Conversation history */}
      {historico.length > 0 && (
        <div className="space-y-5">
          {historico.map((msg, i) => {
            if (msg.tipo === "pergunta") {
              return (
                <div key={i} className="flex justify-end gap-3">
                  <div className="max-w-[75%] rounded-lg rounded-tr-sm bg-brand px-4 py-3 text-sm text-on-brand">
                    {msg.texto}
                  </div>
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-softer text-brand">
                    <User size={14} aria-hidden />
                  </div>
                </div>
              );
            }

            if (msg.tipo === "erro") {
              return (
                <div key={i} className="flex gap-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
                    <Sparkles size={14} aria-hidden />
                  </div>
                  <div className="flex max-w-[75%] items-start gap-2 rounded-lg rounded-tl-sm border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
                    <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
                    {msg.texto}
                  </div>
                </div>
              );
            }

            const r = msg.resultado;
            return (
              <div key={i} className="flex gap-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-softer text-brand">
                  <Sparkles size={14} aria-hidden />
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  {/* Interpretation */}
                  <p className="inline-flex rounded-full border border-line bg-surface-2 px-3 py-1 text-[12px] text-muted">
                    <span className="font-semibold text-ink">Entendi:&nbsp;</span>
                    {r.interpretacao}
                  </p>

                  {/* Insight */}
                  <div className="flex items-start gap-2.5 rounded-lg border border-brand/20 bg-brand-soft px-4 py-3">
                    <Lightbulb size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden />
                    <p className="text-sm leading-relaxed text-ink">{r.insight}</p>
                  </div>

                  {/* Table */}
                  {r.linhas.length > 0 && (
                    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-line">
                            {r.colunas.map((c, ci) => (
                              <th
                                key={ci}
                                className={cn(
                                  "px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted",
                                  c.align === "right" ? "text-right" : "text-left",
                                )}
                              >
                                {c.header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {r.linhas.map((linha, ri) => (
                            <tr key={ri} className="border-b border-line/60 last:border-0">
                              {linha.map((cell, ci) => (
                                <td
                                  key={ci}
                                  className={cn(
                                    "px-4 py-2.5 text-sm text-ink-2",
                                    r.colunas[ci]?.align === "right"
                                      ? "text-right tabular-nums"
                                      : "text-left",
                                  )}
                                >
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <p className="text-[11px] text-faint">
                    {r.totalLinhas} linha{r.totalLinhas === 1 ? "" : "s"} · dados direto do banco ·
                    IA só interpreta
                  </p>
                </div>
              </div>
            );
          })}

          {/* Loading bubble */}
          {pending && (
            <div className="flex gap-3">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-softer text-brand">
                <Sparkles size={14} aria-hidden />
              </div>
              <div className="flex items-center gap-2 rounded-lg rounded-tl-sm border border-line bg-surface px-4 py-3 text-sm text-muted">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand [animation-delay:300ms]" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      )}

      {/* Quick suggestions after first reply */}
      {historico.length > 0 && !pending && (
        <div className="flex flex-wrap gap-2">
          {SUGESTOES.slice(0, 4).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => enviar(s)}
              className="cursor-pointer rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-muted transition-colors hover:border-brand/40 hover:text-ink"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input area — sticky no rodapé */}
      <div className="sticky bottom-4 space-y-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            enviar(pergunta);
          }}
          className="rounded-lg border border-line bg-surface p-3 shadow-(--shadow-2) focus-within:border-brand/40"
        >
          <div className="flex items-end gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-brand-softer text-brand">
              <Sparkles size={16} aria-hidden />
            </span>

            <textarea
              ref={inputRef}
              value={pergunta}
              onChange={(e) => setPergunta(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  enviar(pergunta);
                }
              }}
              rows={1}
              placeholder="O que você quer saber? Ex.: produtos com margem abaixo de 20% este mês"
              className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-sm text-ink outline-none placeholder:text-faint"
            />

            <div className="flex items-center gap-1.5">
              {/* Voz */}
              <button
                type="button"
                onClick={toggleVoz}
                title={gravando ? "Parar gravação" : "Falar (pt-BR)"}
                className={cn(
                  "grid h-9 w-9 cursor-pointer place-items-center rounded-full border transition-colors",
                  gravando
                    ? "animate-pulse border-danger bg-danger-soft text-danger"
                    : "border-line text-muted hover:text-ink",
                )}
              >
                {gravando ? <MicOff size={14} aria-hidden /> : <Mic size={14} aria-hidden />}
              </button>

              {/* Limpar conversa */}
              {historico.length > 0 && (
                <button
                  type="button"
                  onClick={limpar}
                  title="Limpar conversa"
                  className="grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-line text-muted transition-colors hover:border-danger/40 hover:text-danger"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              )}

              {/* Enviar */}
              <button
                type="submit"
                disabled={pending || pergunta.trim().length < 3}
                aria-label="Perguntar"
                className="grid h-9 w-9 cursor-pointer place-items-center rounded-full bg-brand text-on-brand transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowUp size={16} aria-hidden />
              </button>
            </div>
          </div>
        </form>
        <p className="text-center text-[11px] text-faint">
          A IA consulta seus dados reais — nunca inventa números.
        </p>
      </div>
    </div>
  );
}
