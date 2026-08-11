"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Copiar um código para a área de transferência.
 *
 * Existe para o código de barras da ficha: quem está na gôndola com o celular
 * na mão precisa colar o EAN numa busca de fornecedor ou num WhatsApp, e digitar
 * treze dígitos olhando para a tela é onde nasce o erro.
 *
 * A confirmação é a própria marca de certo no lugar do ícone por dois segundos —
 * um toast para "copiei" seria barulho.
 */
export function BotaoCopiar({
  valor,
  rotulo,
  className,
}: {
  valor: string;
  /** O que foi copiado, para o leitor de tela ("código de barras da unidade"). */
  rotulo: string;
  className?: string;
}) {
  const [copiado, setCopiado] = React.useState(false);

  React.useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 2000);
    return () => clearTimeout(t);
  }, [copiado]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
    } catch {
      // Sem permissão de área de transferência (http, navegador antigo):
      // silencioso — o número continua visível ao lado para leitura.
    }
  }

  return (
    <button
      type="button"
      onClick={copiar}
      aria-label={copiado ? "Copiado" : `Copiar ${rotulo}`}
      className={cn(
        "grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none",
        copiado && "text-ok",
        className,
      )}
    >
      {copiado ? (
        <Check className="h-4 w-4" aria-hidden />
      ) : (
        <Copy className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}
