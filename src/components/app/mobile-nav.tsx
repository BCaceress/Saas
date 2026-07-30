"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, X } from "lucide-react";
import { type NavToggles } from "@/components/app/nav-config";
import {
  Acordeao,
  acharAtivo,
  acharModulo,
  filtrarGrupos,
  NavGrupo,
} from "@/components/app/nav-items";
import type { Acesso } from "@/lib/permissoes";

/**
 * Menu completo no celular. Sem ele a sidebar (`hidden md:flex`) simplesmente
 * não existia abaixo de 768px: quem abria o app no telefone não tinha como
 * chegar a nenhuma tela sem digitar a URL.
 *
 * Não reusa `ui/sheet.tsx` de propósito — aquele é um slide-over de formulário,
 * preso à direita. Aqui o gesto é outro: vem da esquerda, de onde o menu mora.
 */
export function MobileNav({
  open,
  onClose,
  toggles,
  acessos,
  planoLabel,
  trialDias,
}: {
  open: boolean;
  onClose: () => void;
  toggles: NavToggles;
  acessos: Acesso[];
  planoLabel: string;
  trialDias: number | null;
}) {
  const pathname = usePathname();
  const painelRef = React.useRef<HTMLDivElement>(null);

  const grupos = React.useMemo(
    () => filtrarGrupos(acessos, toggles),
    [acessos, toggles],
  );
  const activeHref = acharAtivo(grupos, pathname);
  const moduloAtivo = acharModulo(grupos, activeHref);

  // Esc fecha e o corpo para de rolar por trás — mesmo contrato do `Sheet`.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  // Ao abrir, o foco entra no painel: quem navega por teclado ou leitor de tela
  // não fica preso no botão que ficou atrás do overlay.
  React.useEffect(() => {
    if (open) painelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <Acordeao moduloAtivo={moduloAtivo}>
      <div
        className="fixed inset-0 z-50 flex md:hidden print:hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Menu de navegação"
      >
        <div
          className="absolute inset-0 bg-ink/40 backdrop-blur-[2px] animate-[fade_120ms_ease-out]"
          onClick={onClose}
          aria-hidden
        />

        <div
          ref={painelRef}
          tabIndex={-1}
          className="relative flex h-full w-[17.5rem] max-w-[85vw] flex-col bg-surface shadow-[var(--shadow-2)] outline-none animate-[gaveta_180ms_cubic-bezier(0.22,1,0.36,1)]"
        >
          <div className="flex h-15 shrink-0 items-center justify-between border-b border-line px-3">
            <Image
              src="/svg/logoTextoHorizontal.svg"
              alt="NoHub Market"
              width={150}
              height={38}
              loading="eager"
              className="h-auto w-auto object-contain"
            />
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar menu"
              className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>

          <nav
            aria-label="Navegação principal"
            className="scrollbar-hairline flex-1 space-y-5 overflow-y-auto overscroll-contain px-3 py-4"
          >
            {grupos
              .filter((g) => !g.rodape)
              .map((grupo, gi) => (
                <NavGrupo
                  key={grupo.title ?? gi}
                  grupo={grupo}
                  activeHref={activeHref}
                  onNavigate={onClose}
                />
              ))}
          </nav>

          <div className="shrink-0 space-y-2 border-t border-line p-3">
            {grupos
              .filter((g) => g.rodape)
              .map((grupo, gi) => (
                <NavGrupo
                  key={gi}
                  grupo={grupo}
                  activeHref={activeHref}
                  onNavigate={onClose}
                />
              ))}

            <Link
              href="/configuracoes/plano"
              onClick={onClose}
              className="flex items-center justify-between gap-2 rounded-2xl border border-line bg-surface-2 px-3.5 py-2.5"
            >
              <span className="min-w-0">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                  Plano {planoLabel}
                </span>
                <span className="block truncate text-xs text-muted">
                  {trialDias === null
                    ? "Assinatura ativa"
                    : trialDias > 0
                      ? `${trialDias} ${trialDias === 1 ? "dia restante" : "dias restantes"}`
                      : "Período de teste encerrado"}
                </span>
              </span>
              <ArrowRight size={15} className="shrink-0 text-brand" />
            </Link>
          </div>
        </div>

        <style>{`
          @keyframes gaveta { from { transform: translateX(-100%) } to { transform: none } }
          @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
          @media (prefers-reduced-motion: reduce) {
            .animate-\\[gaveta_180ms_cubic-bezier\\(0\\.22\\,1\\,0\\.36\\,1\\)\\],
            .animate-\\[fade_120ms_ease-out\\] { animation: none !important }
          }
        `}</style>
      </div>
    </Acordeao>
  );
}
