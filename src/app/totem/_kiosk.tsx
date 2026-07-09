"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, X, Delete, Loader2, MonitorSmartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PaymentMethod } from "@/generated/prisma";
import type { ProdutoVenda } from "@/app/(app)/vendas/_data";
import { verifyTotemPinAction } from "./actions";
import { TotemVenda } from "./_totem";

const MAX_ERROS = 5;
const COOLDOWN_MS = 30_000;

export function TotemKiosk({
  siteId,
  produtos,
  metodosAtivos,
  tenantNome,
  controleIdade,
  temPin,
}: {
  siteId: string | null;
  produtos: ProdutoVenda[];
  metodosAtivos: PaymentMethod[];
  tenantNome: string;
  controleIdade: boolean;
  temPin: boolean;
}) {
  const router = useRouter();
  const [iniciado, setIniciado] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);

  function iniciar() {
    // Best-effort: iPhone Safari não tem a API; o container fixed cobre a tela.
    document.documentElement.requestFullscreen?.().catch(() => {});
    setIniciado(true);
  }

  function sair() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    router.push("/inicio");
  }

  // ── Tela inicial ──
  if (!iniciado) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-8 p-6 text-center">
        <span className="grid h-20 w-20 place-items-center rounded-3xl bg-brand-soft text-brand">
          <MonitorSmartphone size={40} />
        </span>
        <div>
          <h1 className="font-display text-4xl font-bold text-ink">{tenantNome}</h1>
          <p className="mt-2 text-lg text-muted">Autoatendimento</p>
        </div>
        <button
          onClick={iniciar}
          className="rounded-3xl bg-brand px-12 py-6 font-display text-2xl font-bold text-on-brand shadow-[var(--shadow-1)] transition-colors hover:bg-brand-strong"
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
    <div className="fixed inset-0 z-50 overflow-y-auto bg-bg p-4">
      <TotemVenda
        siteId={siteId}
        produtos={produtos}
        metodosAtivos={metodosAtivos}
        tenantNome={tenantNome}
        controleIdade={controleIdade}
      />
      {/* Saída discreta do quiosque */}
      <button
        onClick={() => (temPin ? setPinOpen(true) : sair())}
        aria-label="Sair do modo quiosque"
        className="fixed right-3 top-3 z-[60] grid h-9 w-9 place-items-center rounded-full border border-line bg-surface/80 text-faint backdrop-blur transition-colors hover:text-ink"
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
              className="rounded-xl border border-line bg-surface-2 py-4 font-display text-xl font-bold text-ink transition-colors hover:bg-brand-soft"
            >
              {d}
            </button>
          ))}
          <button
            onClick={() => setPin((p) => p.slice(0, -1))}
            aria-label="Apagar"
            className="grid place-items-center rounded-xl border border-line bg-surface-2 py-4 text-ink hover:bg-surface"
          >
            <Delete size={20} />
          </button>
          <button
            onClick={() => digito("0")}
            className="rounded-xl border border-line bg-surface-2 py-4 font-display text-xl font-bold text-ink transition-colors hover:bg-brand-soft"
          >
            0
          </button>
          <button
            onClick={confirmar}
            disabled={pin.length < 4 || pending}
            className="grid place-items-center rounded-xl bg-brand py-4 font-bold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-40"
          >
            {pending ? <Loader2 size={20} className="animate-spin" /> : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
