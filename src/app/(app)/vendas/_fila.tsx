"use client";

// Fila do autoatendimento — coluna lateral do PDV.
// Uma caixa de entrada operacional: quem aguarda pagamento fica no topo com
// destaque; quem já pagou fica ancorado no rodapé, só para acompanhamento.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, MonitorSmartphone, Volume2, VolumeX, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  pollAutoatendimentoAction,
  cancelarVendaAction,
  type FilaAutoatendimento,
  type VendaTotemFila,
} from "./actions";
import { brl } from "./_shared";

const POLL_MS = 5_000;
const SOM_KEY = "nohub.pdv.som";
const VOL_KEY = "nohub.pdv.som.vol";

const METODO_LABEL: Record<string, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CARTAO_CREDITO: "Crédito",
  CARTAO_DEBITO: "Débito",
  OUTRO: "Outro",
};

function tempoRel(iso: string, agora: number): string {
  const min = Math.floor((agora - new Date(iso).getTime()) / 60_000);
  if (min <= 0) return "agora";
  if (min === 1) return "há 1 min";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return h === 1 ? "há 1 h" : `há ${h} h`;
}

// ── Áudio ────────────────────────────────────────────────────
// AudioContext único, destravado no primeiro gesto do operador (política de
// autoplay dos navegadores bloqueia som sem interação prévia).
let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

/** Bip curto de duas notas. `vol` 0..1. */
function bip(vol: number) {
  const ctx = getAudioCtx();
  if (!ctx || ctx.state !== "running" || vol <= 0) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.connect(g);
  g.connect(ctx.destination);
  o.type = "sine";
  const pico = 0.4 * vol;
  o.frequency.value = 880;
  g.gain.setValueAtTime(pico, ctx.currentTime);
  o.frequency.setValueAtTime(1174, ctx.currentTime + 0.1);
  g.gain.setValueAtTime(pico, ctx.currentTime + 0.1);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);
  o.start();
  o.stop(ctx.currentTime + 0.34);
}

const lerVol = () => {
  if (typeof window === "undefined") return 0.6;
  const v = parseFloat(window.localStorage.getItem(VOL_KEY) ?? "");
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.6;
};

export function FilaAutoatendimentoPanel({
  siteId,
  saleIdEmAtendimento,
  bump,
  onReceber,
}: {
  siteId: string;
  /** Venda já carregada no PDV — some da fila enquanto está em atendimento. */
  saleIdEmAtendimento: string | null;
  /** Incrementado pelo PDV para forçar atualização imediata da fila. */
  bump: number;
  onReceber: (venda: VendaTotemFila) => void;
}) {
  const [fila, setFila] = useState<FilaAutoatendimento | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  // Preferências do aparelho (SSR assume ligado / 60%).
  const [som, setSom] = useState(
    () =>
      typeof window === "undefined" ||
      window.localStorage.getItem(SOM_KEY) !== "off",
  );
  const [vol, setVol] = useState(lerVol);
  const [somOpen, setSomOpen] = useState(false);
  const [descartando, setDescartando] = useState<string | null>(null);
  const [pendingDescarte, setPendingDescarte] = useState(false);
  const idsAnteriores = useRef<Set<string> | null>(null);

  // Destrava o áudio no primeiro gesto (clique/tecla) da sessão.
  useEffect(() => {
    const destravar = () => getAudioCtx();
    window.addEventListener("pointerdown", destravar, { once: true });
    window.addEventListener("keydown", destravar, { once: true });
    return () => {
      window.removeEventListener("pointerdown", destravar);
      window.removeEventListener("keydown", destravar);
    };
  }, []);

  function toggleSom() {
    setSom((v) => {
      window.localStorage.setItem(SOM_KEY, v ? "off" : "on");
      return !v;
    });
  }

  function mudarVol(v: number) {
    setVol(v);
    window.localStorage.setItem(VOL_KEY, String(v));
  }

  const atualizar = useCallback(async () => {
    try {
      const f = await pollAutoatendimentoAction(siteId);
      setAgora(Date.now());
      // Nova venda aguardando → bip discreto (nunca no primeiro carregamento).
      const somLigado = window.localStorage.getItem(SOM_KEY) !== "off";
      const ids = new Set(f.aguardando.map((v) => v.id));
      if (idsAnteriores.current && somLigado) {
        const chegouNova = f.aguardando.some((v) => !idsAnteriores.current!.has(v.id));
        if (chegouNova) bip(lerVol());
      }
      idsAnteriores.current = ids;
      setFila(f);
    } catch {
      // rede instável: mantém o último estado; a próxima rodada tenta de novo
    }
  }, [siteId]);

  useEffect(() => {
    // Primeira rodada via timeout: efeito só agenda, sem setState síncrono.
    const t0 = window.setTimeout(atualizar, 0);
    const t = window.setInterval(atualizar, POLL_MS);
    return () => {
      window.clearTimeout(t0);
      window.clearInterval(t);
    };
  }, [atualizar, bump]);

  async function descartar(id: string) {
    setPendingDescarte(true);
    try {
      await cancelarVendaAction(id);
      setDescartando(null);
      await atualizar();
    } finally {
      setPendingDescarte(false);
    }
  }

  const aguardando = (fila?.aguardando ?? []).filter((v) => v.id !== saleIdEmAtendimento);
  const concluidas = fila?.concluidas ?? [];
  const terminais = fila?.terminaisAtivos ?? 0;

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface lg:flex-1">
      {/* Cabeçalho compacto */}
      <div className="relative border-b border-line px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
            Autoatendimento
          </span>
          <span className="flex items-center gap-1.5">
            {aguardando.length > 0 && (
              <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums text-accent">
                {aguardando.length} aguardando
              </span>
            )}
            <button
              onClick={() => setSomOpen((v) => !v)}
              aria-label="Alerta sonoro"
              aria-expanded={somOpen}
              title="Alerta sonoro"
              className={cn(
                "grid h-7 w-7 cursor-pointer place-items-center rounded-full transition-colors hover:bg-surface-2 hover:text-ink",
                somOpen ? "bg-surface-2 text-ink" : "text-faint",
              )}
            >
              {som ? <Volume2 size={14} /> : <VolumeX size={14} />}
            </button>
          </span>
        </div>
        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              terminais > 0 ? "bg-ok" : "bg-faint",
            )}
          />
          {terminais === 0
            ? "Nenhum terminal ativo"
            : terminais === 1
              ? "1 terminal ativo"
              : `${terminais} terminais ativos`}
        </p>

        {/* Popover do som: liga/desliga, volume e teste */}
        {somOpen && (
          <>
            <div
              className="fixed inset-0 z-30"
              onClick={() => setSomOpen(false)}
              aria-hidden
            />
            <div className="absolute right-2 top-full z-40 mt-1 w-56 rounded-[var(--radius)] border border-line bg-surface p-3 shadow-[var(--shadow-2)]">
              <label className="flex cursor-pointer items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-ink">Alerta sonoro</span>
                <input
                  type="checkbox"
                  checked={som}
                  onChange={toggleSom}
                  className="h-4 w-4 cursor-pointer accent-[var(--brand)]"
                />
              </label>
              <label className="mt-3 flex flex-col gap-1.5">
                <span className="flex items-center justify-between text-[11px] text-muted">
                  Volume
                  <span className="font-mono tabular-nums">{Math.round(vol * 100)}%</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(vol * 100)}
                  disabled={!som}
                  onChange={(e) => mudarVol(Number(e.target.value) / 100)}
                  className="w-full cursor-pointer accent-[var(--brand)] disabled:opacity-40"
                />
              </label>
              <button
                onClick={() => bip(vol)}
                disabled={!som || vol <= 0}
                className="mt-3 min-h-[2.25rem] w-full cursor-pointer rounded-full border border-line text-xs font-semibold text-ink transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-45"
              >
                Testar som
              </button>
            </div>
          </>
        )}
      </div>

      {/* Aguardando pagamento — prioridade máxima, área rolável */}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {fila === null ? (
          <div className="grid place-items-center py-10 text-faint">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : aguardando.length === 0 ? (
          /* Estado vazio — enxuto, sem ilustração */
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-4 py-8 text-center">
            <MonitorSmartphone size={20} className="mb-1 text-faint" />
            <p className="text-sm font-medium text-ink">Nenhuma venda aguardando</p>
            <p className="text-xs text-muted">
              Os pedidos dos terminais aparecerão aqui.
            </p>
          </div>
        ) : (
          <div className="px-3.5 py-3">
            <p className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-accent">
              Aguardando pagamento
            </p>
            <div className="flex flex-col gap-1.5">
              {aguardando.map((v) => (
                <div
                  key={v.id}
                  className="group rounded-[var(--radius)] border border-accent/35 bg-accent-soft/40 px-3 py-2"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold text-ink">
                      {v.terminal ?? "Terminal"}
                      <span className="ml-1.5 font-mono text-[11px] font-medium text-muted">
                        {v.numero}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted">
                      {tempoRel(v.criadaEm, agora)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="text-[12px] text-muted">
                      {v.numItens} {v.numItens === 1 ? "item" : "itens"}
                    </span>
                    <span className="font-mono text-[13px] font-bold tabular-nums text-ink">
                      {brl(v.total)}
                    </span>
                  </div>
                  {descartando === v.id ? (
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-danger">Descartar este pedido?</span>
                      <span className="flex gap-1">
                        <button
                          onClick={() => descartar(v.id)}
                          disabled={pendingDescarte}
                          className="cursor-pointer rounded-full bg-danger px-2.5 py-1 text-[11px] font-semibold text-on-brand disabled:opacity-50"
                        >
                          {pendingDescarte ? "…" : "Sim"}
                        </button>
                        <button
                          onClick={() => setDescartando(null)}
                          className="cursor-pointer rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-muted hover:text-ink"
                        >
                          Não
                        </button>
                      </span>
                    </div>
                  ) : (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <button
                        onClick={() => onReceber(v)}
                        className="min-h-[2rem] flex-1 cursor-pointer rounded-full bg-brand px-3 text-[12px] font-semibold text-on-brand transition-colors hover:bg-brand-strong"
                      >
                        Receber
                      </button>
                      <button
                        onClick={() => setDescartando(v.id)}
                        aria-label={`Descartar pedido ${v.numero}`}
                        title="Descartar pedido"
                        className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full text-faint opacity-0 transition-opacity hover:bg-surface-2 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Concluídas recentemente — ancoradas no rodapé, só acompanhamento */}
      {concluidas.length > 0 && (
        <div className="shrink-0 border-t border-line px-3.5 pb-2.5 pt-2">
          <p className="mb-1 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-faint">
            Concluídas recentemente
          </p>
          <div className="scrollbar-thin flex max-h-40 flex-col overflow-y-auto">
            {concluidas.map((v) => (
              <div
                key={v.id}
                className="flex items-center gap-2 border-b border-line/60 py-1.5 last:border-0"
              >
                <Check size={12} className="shrink-0 text-ok" />
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">
                  {v.terminal ?? "Terminal"}
                  <span className="text-muted"> · {v.numItens} {v.numItens === 1 ? "item" : "itens"}</span>
                </span>
                <span className="shrink-0 font-mono text-[12px] tabular-nums text-ink-2">
                  {brl(v.total)}
                </span>
                <span className="w-14 shrink-0 text-right text-[10px] text-faint">
                  {v.metodo ? METODO_LABEL[v.metodo] ?? v.metodo : ""} · {tempoRel(v.pagaEm, agora)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
