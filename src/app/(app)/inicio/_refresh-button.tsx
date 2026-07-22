"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Atualizado às HH:mm" + botão que força um re-fetch do RSC sem trocar de página.
 *
 * A hora vem direto da prop (o RSC re-renderiza a cada refresh) — guardá-la em
 * `useState` congelaria o valor da primeira renderização e o painel diria uma
 * hora velha logo depois de atualizar.
 */
export function RefreshButton({ atualizadoEm }: { atualizadoEm: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2 text-xs text-faint print:hidden">
      <span className="hidden sm:inline" aria-live="polite">
        Atualizado às {atualizadoEm}
      </span>
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        aria-label="Atualizar dados"
        title="Atualizar dados"
        className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-60"
      >
        <RefreshCw size={14} className={cn(pending && "animate-spin")} />
      </button>
    </div>
  );
}
