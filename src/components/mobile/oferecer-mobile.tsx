"use client";

import { useSyncExternalStore } from "react";
import { Smartphone, X } from "lucide-react";
import { usarVersaoMobileAction } from "@/app/(mobile)/m/mais/actions";

const DISPENSADO = "nohub:mobile:dispensado";
const CONSULTA = "(max-width: 767px)";

/* Store externo pelo mesmo motivo do InstalarApp: "cabe numa tela pequena?" é
   estado do navegador, não do React, e ler isso num efeito viraria setState em
   cascata. O `matchMedia` ainda avisa quando a pessoa gira o aparelho. */

let visivel = false;
const ouvintes = new Set<() => void>();

function emitir(novo: boolean) {
  if (visivel === novo) return;
  visivel = novo;
  for (const o of ouvintes) o();
}

function calcular(): boolean {
  if (localStorage.getItem(DISPENSADO) === "1") return false;
  // Já instalado como app: quem chegou aqui veio de propósito pelo link.
  if (window.matchMedia("(display-mode: standalone)").matches) return false;
  return window.matchMedia(CONSULTA).matches;
}

function inscrever(ouvinte: () => void) {
  const primeiro = ouvintes.size === 0;
  ouvintes.add(ouvinte);

  const mq = window.matchMedia(CONSULTA);
  const aoMudar = () => emitir(calcular());
  if (primeiro) {
    mq.addEventListener("change", aoMudar);
    emitir(calcular());
  }

  return () => {
    ouvintes.delete(ouvinte);
    if (ouvintes.size === 0) mq.removeEventListener("change", aoMudar);
  };
}

const ler = () => visivel;
const lerServidor = () => false;

function dispensar() {
  localStorage.setItem(DISPENSADO, "1");
  emitir(false);
}

/**
 * Convite discreto, no topo do `/inicio`, para quem abriu o app completo num
 * celular. Não redireciona sozinho — a escolha é da pessoa, e um gestor pode
 * ter aberto o link de um relatório específico de propósito.
 *
 * Aceitar grava o cookie de superfície: dali em diante, abrir a raiz do
 * subdomínio cai no `/m`.
 */
export function OferecerMobile() {
  const mostrar = useSyncExternalStore(inscrever, ler, lerServidor);
  if (!mostrar) return null;

  return (
    <div className="relative flex items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-brand-soft p-3 md:hidden">
      <Smartphone className="h-5 w-5 shrink-0 text-brand-strong" aria-hidden />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">Você está no celular</p>
        <p className="text-[13px] text-ink-2">
          A versão mobile é mais rápida e feita para usar de pé.
        </p>
      </div>

      <form action={usarVersaoMobileAction} className="shrink-0">
        <button
          type="submit"
          className="min-h-10 cursor-pointer rounded-full bg-brand px-4 text-sm font-medium text-on-brand hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          Abrir
        </button>
      </form>

      <button
        type="button"
        onClick={dispensar}
        aria-label="Dispensar"
        className="-mr-1 grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
