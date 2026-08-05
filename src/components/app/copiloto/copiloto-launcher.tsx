"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";
import { CopilotoPanel } from "./copiloto-panel";

/** Telas onde o copiloto não deve aparecer: PDV e autoatendimento pedem tela cheia. */
const ROTAS_BLOQUEADAS = ["/vendas", "/totem"];

/**
 * Botão flutuante do copiloto — montado no `AppShell`, ao lado do
 * `CommandPalette`. Some enquanto o painel está aberto (o `Sheet` já cobre a
 * tela) em vez de disputar z-index com ele.
 */
export function CopilotoLauncher({ podeVer }: { podeVer: boolean }) {
  const pathname = usePathname();
  const [aberto, setAberto] = React.useState(false);

  const bloqueado = ROTAS_BLOQUEADAS.some(
    (rota) => pathname === rota || pathname?.startsWith(`${rota}/`),
  );

  if (!podeVer || bloqueado) return null;

  return (
    <>
      {!aberto && (
        <button
          type="button"
          onClick={() => setAberto(true)}
          aria-label="Abrir NoHub IA"
          className="fixed bottom-20 right-4 z-45 flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-brand text-on-brand shadow-[var(--shadow-2)] transition-transform hover:scale-105 md:bottom-5 md:right-5 print:hidden"
        >
          <Sparkles size={22} />
        </button>
      )}
      <CopilotoPanel open={aberto} onClose={() => setAberto(false)} />
    </>
  );
}
