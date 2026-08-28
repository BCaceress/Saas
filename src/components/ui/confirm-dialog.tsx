"use client";

import * as React from "react";

/**
 * Modal de confirmação para ação destrutiva. Ação irreversível pede confirmação
 * explícita — o clique errado no ícone de lixeira não pode custar o que a pessoa
 * digitou. Esc e o clique fora cancelam; o foco vai para o botão de cancelar,
 * nunca para o destrutivo.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel = "Excluir",
  cancelLabel = "Cancelar",
  pending = false,
  tone = "danger",
  onConfirm,
  onCancel,
}: {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  tone?: "danger" | "brand";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = React.useId();
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/30 p-0 sm:items-center sm:p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-titulo`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-[var(--radius-xl)] border border-line bg-surface p-5 shadow-[var(--shadow-float)] sm:rounded-[var(--radius-xl)]"
      >
        <h2
          id={`${id}-titulo`}
          className="font-display text-[17px] font-semibold text-ink"
        >
          {title}
        </h2>
        {description && (
          <div className="mt-1.5 text-[13px] leading-relaxed text-muted">
            {description}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={
              tone === "danger"
                ? "rounded-full bg-danger px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:opacity-90 disabled:opacity-50"
                : "rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50"
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
