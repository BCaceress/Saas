"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { CopilotoPanel } from "./copiloto-panel";

/** Telas onde o copiloto não deve aparecer: PDV e autoatendimento pedem tela cheia. */
const ROTAS_BLOQUEADAS = ["/vendas", "/totem"];

/**
 * Botão flutuante do copiloto — montado no `AppShell`, ao lado do
 * `CommandPalette`. Some enquanto o painel está aberto (o `Sheet` já cobre a
 * tela) em vez de disputar z-index com ele.
 */
export function CopilotoLauncher({
  podeVer,
  posicao,
}: {
  podeVer: boolean;
  /**
   * Posição do botão. O padrão é o canto inferior direito — a casca `(app)`
   * não tem mais barra no rodapé para desviar. A superfície `/m` passa a sua,
   * porque lá a barra de polegar é flutuante e existe em TODA largura.
   */
  posicao?: string;
}) {
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
          className={cn(
            "fixed z-45 flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-brand text-on-brand shadow-[var(--shadow-2)] transition-transform hover:scale-105 print:hidden",
            posicao ?? "bottom-5 right-4 md:right-5",
          )}
        >
          <Sparkles size={22} />
        </button>
      )}
      <CopilotoPanel open={aberto} onClose={() => setAberto(false)} />
    </>
  );
}
