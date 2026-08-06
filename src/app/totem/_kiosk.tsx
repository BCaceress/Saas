"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, X, Delete, Loader2, MonitorSmartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PaymentMethod } from "@/generated/prisma";
import type { ProdutoVenda } from "@/app/(app)/vendas/_data";
import { verifyTotemPinAction, registrarTerminalAction, type TerminalStatus } from "./actions";
import { TotemVenda } from "./_totem";

const DEVICE_KEY = "nohub.totem.deviceId";
const HEARTBEAT_MS = 45_000;

const MAX_ERROS = 5;
const COOLDOWN_MS = 30_000;

/** App instalado na tela de início — a tela já é cheia. */
function emStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function TotemKiosk({
  siteId,
  produtos,
  metodosAtivos,
  tenantNome,
  tenantLogoUrl,
  controleIdade,
  temPin,
  maisVendidos,
}: {
  siteId: string | null;
  produtos: ProdutoVenda[];
  metodosAtivos: PaymentMethod[];
  tenantNome: string;
  tenantLogoUrl: string | null;
  controleIdade: boolean;
  temPin: boolean;
  maisVendidos: string[];
}) {
  const router = useRouter();
  const [iniciado, setIniciado] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [terminal, setTerminal] = useState<TerminalStatus | null>(null);

  // Registro + heartbeat do terminal (identifica o aparelho na fila do PDV e
  // informa se há caixa aberto — sem caixa, novas vendas ficam bloqueadas).
  useEffect(() => {
    if (!siteId) return;
    let vivo = true;
    async function ping() {
      try {
        const salvo = window.localStorage.getItem(DEVICE_KEY);
        const st = await registrarTerminalAction({ siteId: siteId!, deviceId: salvo });
        if (!vivo) return;
        window.localStorage.setItem(DEVICE_KEY, st.id);
        setTerminal(st);
      } catch {
        // rede/sessão instável: mantém o último estado conhecido
      }
    }
    ping();
    const t = window.setInterval(ping, HEARTBEAT_MS);
    return () => {
      vivo = false;
      window.clearInterval(t);
    };
  }, [siteId]);

  function iniciar() {
    // Instalado como app já abre em tela cheia — pedir de novo só gera exceção
    // silenciosa. Fora disso é best-effort: iPhone Safari não tem a API, e o
    // container fixed cobre a tela de qualquer jeito.
    if (!emStandalone()) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
    setIniciado(true);
  }

  function sair() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    router.push("/inicio");
  }

  // Tela apagando no meio da venda é o pior defeito de um quiosque em celular:
  // o cliente perde o carrinho e chama o operador. O wake lock cai sozinho
  // quando a aba vai para segundo plano, então é preciso repedir na volta.
  useEffect(() => {
    if (!iniciado) return;
    let sentinel: WakeLockSentinel | null = null;
    let vivo = true;

    const pedir = async () => {
      try {
        sentinel = (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        // Sem suporte, bateria baixa ou permissão negada: segue sem travar.
      }
    };

    const aoVoltar = () => {
      if (vivo && document.visibilityState === "visible") void pedir();
    };

    void pedir();
    document.addEventListener("visibilitychange", aoVoltar);

    return () => {
      vivo = false;
      document.removeEventListener("visibilitychange", aoVoltar);
      void sentinel?.release().catch(() => {});
    };
  }, [iniciado]);

  // ── Tela inicial ──
  // Escalas em dois degraus: o desenho nasceu para tablet em pé, e em 390px a
  // logo de 160px mais o título de 36px empurravam o botão para fora da dobra.
  if (!iniciado) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-center sm:gap-8 sm:p-6">
        {tenantLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tenantLogoUrl} alt={tenantNome}
            className="h-28 w-28 rounded-3xl border border-line bg-surface object-contain p-3 shadow-[var(--shadow-1)] sm:h-40 sm:w-40" />
        ) : (
          <span className="grid h-20 w-20 place-items-center rounded-3xl bg-brand-soft text-brand">
            <MonitorSmartphone size={40} />
          </span>
        )}
        <div>
          <h1 className="font-display text-3xl font-bold text-ink sm:text-4xl">{tenantNome}</h1>
          <p className="mt-2 text-base text-muted sm:text-lg">Autoatendimento</p>
        </div>
        <button
          onClick={iniciar}
          className="w-full max-w-sm rounded-3xl bg-brand px-8 py-5 font-display text-xl font-bold text-on-brand shadow-[var(--shadow-1)] transition-colors hover:bg-brand-strong sm:w-auto sm:px-12 sm:py-6 sm:text-2xl"
        >
          Toque para começar
        </button>
        <button
          onClick={() => router.push("/inicio")}
          className="text-sm text-faint underline-offset-4 hover:text-muted hover:underline"
        >
          Voltar ao painel
        </button>
      </div>
    );
  }

  // ── Modo quiosque ──
  return (
    <div className="scrollbar-none fixed inset-0 z-50 overflow-y-auto bg-bg p-2 sm:p-4">
      <TotemVenda
        siteId={siteId}
        produtos={produtos}
        metodosAtivos={metodosAtivos}
        tenantNome={tenantNome}
        tenantLogoUrl={tenantLogoUrl}
        controleIdade={controleIdade}
        maisVendidos={maisVendidos}
        totemDeviceId={terminal?.id ?? null}
        terminalNome={terminal?.nome ?? null}
        caixaAberto={terminal?.caixaAberto ?? true}
      />
      {/* Saída discreta do quiosque */}
      <button
        onClick={() => (temPin ? setPinOpen(true) : sair())}
        aria-label="Sair do modo quiosque"
        // O notch come o canto superior direito quando o app roda em tela
        // cheia; sem a área segura, o botão de sair fica embaixo dele.
        className="fixed right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[60] grid h-9 w-9 place-items-center rounded-full border border-line bg-surface/80 text-faint backdrop-blur transition-colors hover:text-ink"
      >
        <Lock size={15} />
      </button>
      {pinOpen && <PinDialog onClose={() => setPinOpen(false)} onSuccess={sair} />}
    </div>
  );
}

// ── Dialog de PIN (teclado touch) ────────────────────────────
function PinDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [pin, setPin] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const erros = useRef(0);
  const bloqueadoAte = useRef(0);

  function digito(d: string) {
    setErro(null);
    setPin((p) => (p.length >= 6 ? p : p + d));
  }

  function confirmar() {
    const agora = Date.now();
    if (agora < bloqueadoAte.current) {
      const s = Math.ceil((bloqueadoAte.current - agora) / 1000);
      setErro(`Muitas tentativas — aguarde ${s}s.`);
      return;
    }
    start(async () => {
      const ok = await verifyTotemPinAction(pin);
      if (ok) {
        onSuccess();
        return;
      }
      erros.current += 1;
      setPin("");
      if (erros.current >= MAX_ERROS) {
        erros.current = 0;
        bloqueadoAte.current = Date.now() + COOLDOWN_MS;
        setErro("Muitas tentativas — aguarde 30 segundos.");
      } else {
        setErro("PIN incorreto.");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Sair do modo quiosque"
    >
      <div className="w-full max-w-xs rounded-[var(--radius-lg)] border border-line bg-surface p-5 shadow-[var(--shadow-2)]">
        <div className="mb-4 flex items-center justify-between">
          <p className="font-semibold text-ink">PIN do operador</p>
          <button onClick={onClose} aria-label="Cancelar" className="text-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>

        {/* Indicador dos dígitos */}
        <div className="mb-4 flex justify-center gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-3 w-3 rounded-full border border-line",
                i < pin.length ? "bg-brand border-brand" : "bg-surface-2",
              )}
            />
          ))}
        </div>
        {erro && <p className="mb-3 text-center text-sm text-danger">{erro}</p>}

        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button
              key={d}
              onClick={() => digito(d)}
              className="rounded-xl border border-line bg-surface-2 min-h-14 py-4 font-display text-xl font-bold text-ink transition-colors hover:bg-brand-soft"
            >
              {d}
            </button>
          ))}
          <button
            onClick={() => setPin((p) => p.slice(0, -1))}
            aria-label="Apagar"
            className="grid place-items-center rounded-xl border border-line bg-surface-2 min-h-14 py-4 text-ink hover:bg-surface"
          >
            <Delete size={20} />
          </button>
          <button
            onClick={() => digito("0")}
            className="rounded-xl border border-line bg-surface-2 min-h-14 py-4 font-display text-xl font-bold text-ink transition-colors hover:bg-brand-soft"
          >
            0
          </button>
          <button
            onClick={confirmar}
            disabled={pin.length < 4 || pending}
            className="grid place-items-center rounded-xl bg-brand min-h-14 py-4 font-bold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-40"
          >
            {pending ? <Loader2 size={20} className="animate-spin" /> : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
