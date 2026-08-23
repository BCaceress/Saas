"use client";

import { useSyncExternalStore } from "react";
import { Smartphone, X } from "lucide-react";
import { usarVersaoMobileAction } from "@/app/(mobile)/m/mais/actions";

const DISPENSADO = "nohub:mobile:dispensado";
/**
 * Aparelho de mão: tela pequena OU tela de tablet com dedo (ponteiro grosso e
 * sem hover). O segundo caso existe por causa do iPad em modo desktop, que se
 * anuncia como Macintosh — o servidor não tem como saber, o navegador sim.
 */
const CONSULTA =
  "(max-width: 767px), (max-width: 1180px) and (pointer: coarse) and (hover: none)";

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
 * Convite discreto, no topo de QUALQUER tela do app completo, para quem o
 * abriu num aparelho de mão. Montado no `AppShell` — vivia só no `/inicio`, e
 * quem entrava por um link direto (relatório, pedido, cotação) nunca via a
 * oferta e ficava no layout apertado, agora sem nem a barra inferior que essa
 * casca tinha.
 *
 * Não redireciona sozinho — a escolha é da pessoa, e um gestor pode ter aberto
 * o link de um relatório específico de propósito.
 *
 * Aceitar grava o cookie de superfície: dali em diante, abrir a raiz do
 * subdomínio cai no `/m`.
 */
export function OferecerMobile() {
  const mostrar = useSyncExternalStore(inscrever, ler, lerServidor);
  if (!mostrar) return null;

  return (
    // Sem `md:hidden`: em tablet o convite precisa aparecer, e quem decide se
    // ele existe é a media query do store, não o breakpoint do layout.
    // `print:hidden` porque agora o convite acompanha todas as telas —
    // inclusive os relatórios que saem em PDF.
    <div className="relative flex items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-brand-soft p-3 print:hidden">
      <Smartphone className="h-5 w-5 shrink-0 text-brand-strong" aria-hidden />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">Você está num aparelho de mão</p>
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
