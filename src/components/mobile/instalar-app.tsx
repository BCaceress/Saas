"use client";

import { useSyncExternalStore } from "react";
import { Share, X, Download, SquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DISPENSADO = "nohub:instalar:dispensado";

/**
 * Evento do Chrome/Edge que oferece a instalação. Não existe no lib.dom, e o
 * Safari nunca dispara — daí o caminho separado de instrução para iOS.
 */
type PromptInstalacao = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Modo = "oculto" | "ios" | "android";

/* ── Store ────────────────────────────────────────────────────────────────
   Se pode ou não instalar é estado do NAVEGADOR, não do React: depende de um
   evento que o Chrome dispara quando quer, do modo de exibição e de uma escolha
   gravada em localStorage. Um store externo evita o setState-em-efeito que essa
   leitura exigiria, e permite que várias instâncias do convite (home e "Mais")
   concordem entre si. */

let prompt: PromptInstalacao | null = null;
let modo: Modo = "oculto";
const ouvintes = new Set<() => void>();

function emitir(novo: Modo) {
  if (modo === novo) return;
  modo = novo;
  for (const ouvinte of ouvintes) ouvinte();
}

function jaInstalado(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS só expõe o estado por essa propriedade fora do padrão.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function calcularModo(): Modo {
  if (jaInstalado()) return "oculto";
  if (localStorage.getItem(DISPENSADO) === "1") return "oculto";
  if (prompt) return "android";
  // No iOS não existe API de instalação: o único caminho é o menu Compartilhar,
  // então o convite aparece direto, com o passo a passo.
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return "ios";
  return "oculto";
}

function aoOferecer(e: Event) {
  // Sem isto o Chrome mostra a própria barra dele, fora do fluxo da tela.
  e.preventDefault();
  prompt = e as PromptInstalacao;
  emitir(calcularModo());
}

function aoInstalar() {
  prompt = null;
  emitir("oculto");
}

function inscrever(ouvinte: () => void) {
  const primeiro = ouvintes.size === 0;
  ouvintes.add(ouvinte);

  if (primeiro) {
    window.addEventListener("beforeinstallprompt", aoOferecer);
    window.addEventListener("appinstalled", aoInstalar);
    emitir(calcularModo());
  }

  return () => {
    ouvintes.delete(ouvinte);
    if (ouvintes.size === 0) {
      window.removeEventListener("beforeinstallprompt", aoOferecer);
      window.removeEventListener("appinstalled", aoInstalar);
    }
  };
}

const lerModo = () => modo;
/** No servidor não dá para saber — o convite entra depois da hidratação. */
const lerModoServidor = (): Modo => "oculto";

function dispensar() {
  localStorage.setItem(DISPENSADO, "1");
  emitir("oculto");
}

async function instalar() {
  if (!prompt) return;
  const atual = prompt;
  prompt = null;
  await atual.prompt();
  const { outcome } = await atual.userChoice;
  // Recusou: o browser não oferece de novo nesta sessão, então some de vez.
  if (outcome === "dismissed") localStorage.setItem(DISPENSADO, "1");
  emitir("oculto");
}

/* ── Componente ─────────────────────────────────────────────────────────── */

/**
 * Convite para instalar o app na tela de início. Some sozinho quando já está
 * instalado, quando a pessoa dispensa, ou quando o browser não oferece nada de
 * útil (desktop sem suporte, navegador embutido de outro app).
 */
export function InstalarApp({ className }: { className?: string }) {
  const modoAtual = useSyncExternalStore(inscrever, lerModo, lerModoServidor);

  if (modoAtual === "oculto") return null;

  return (
    <div
      className={cn(
        "relative rounded-2xl border border-line bg-surface p-4 text-ink shadow-[var(--shadow-1)]",
        className,
      )}
    >
      <button
        type="button"
        onClick={dispensar}
        aria-label="Dispensar"
        className="absolute top-2 right-2 grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
      >
        <X className="h-4 w-4" />
      </button>

      <p className="pr-8 font-display text-base font-semibold">
        Deixe o NoHub na tela de início
      </p>
      <p className="mt-1 text-sm text-ink-2">
        Abre em tela cheia, carrega mais rápido e recebe os avisos de estoque.
      </p>

      {modoAtual === "ios" ? (
        <ol className="mt-3 space-y-2 text-sm text-ink-2">
          <li className="flex items-center gap-2">
            <Share className="h-4 w-4 shrink-0 text-accent" aria-hidden />
            Toque em <strong className="font-medium text-ink">Compartilhar</strong>, na
            barra do Safari
          </li>
          <li className="flex items-center gap-2">
            <SquarePlus className="h-4 w-4 shrink-0 text-accent" aria-hidden />
            Escolha{" "}
            <strong className="font-medium text-ink">Adicionar à Tela de Início</strong>
          </li>
        </ol>
      ) : (
        <Button type="button" onClick={instalar} className="mt-3 w-full sm:w-auto">
          <Download className="h-4 w-4" aria-hidden />
          Instalar app
        </Button>
      )}
    </div>
  );
}
