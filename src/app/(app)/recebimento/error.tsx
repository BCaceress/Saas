"use client";

import { useEffect } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";

/**
 * A consulta da aba falhou.
 *
 * Cada aba consulta o banco por conta própria; quando uma delas cai, o operador
 * precisa de duas coisas — saber que a lista não é "vazia", e poder tentar de
 * novo sem perder o recorte que já estava na URL. `reset()` refaz só esta
 * consulta, mantendo aba, busca e página.
 */
export default function RecebimentosError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[recebimento] falha ao carregar a lista", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-lg)] border border-line bg-surface px-6 py-14 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-danger-soft text-danger">
        <TriangleAlert size={20} />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-base font-semibold text-ink">
          Não deu para carregar os recebimentos
        </h2>
        <p className="max-w-sm text-sm text-muted">
          A consulta desta aba falhou. Tente de novo — o recorte e a busca continuam como estavam.
        </p>
      </div>
      <button
        type="button"
        onClick={reset}
        className="flex cursor-pointer items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
      >
        <RotateCw size={14} />
        Tentar de novo
      </button>
    </div>
  );
}
