"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Slide-over para os sidepanels (Marcas, Categorias, Armazenagem, Fornecedores)
 * e formulários de produto. Controlado por `open`/`onClose`.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: "md" | "lg" | "xl";
}) {
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

  if (!open) return null;

  const widths = { md: "max-w-md", lg: "max-w-lg", xl: "max-w-2xl" };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="absolute inset-0 bg-ink/30 backdrop-blur-[2px] animate-[fade_120ms_ease-out]"
        onClick={onClose}
        aria-hidden
      />
      <div
        className={cn(
          "relative flex h-full w-full flex-col overflow-hidden rounded-l-[var(--radius-xl)] bg-surface shadow-[var(--shadow-2)]",
          "animate-[slidein_160ms_cubic-bezier(0.22,1,0.36,1)]",
          widths[width]
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="border-t border-line px-5 py-3.5">{footer}</footer>
        )}
      </div>
      <style>{`
        @keyframes slidein { from { transform: translateX(16px); opacity: 0 } to { transform: none; opacity: 1 } }
        @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[slidein_160ms_cubic-bezier\\(0\\.22\\,1\\,0\\.36\\,1\\)\\],
          .animate-\\[fade_120ms_ease-out\\] { animation: none !important }
        }
      `}</style>
    </div>
  );
}

/**
 * Diálogo centralizado. Usado para finalizar cadastros sobre um sidepanel
 * (fornecedor por CNPJ, nova/editar subcategoria). Empilha acima do Sheet.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: "md" | "lg" | "xl" | "2xl";
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const widths = { md: "max-w-md", lg: "max-w-lg", xl: "max-w-2xl", "2xl": "max-w-3xl" };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px] animate-[fade_120ms_ease-out]"
        onClick={onClose}
        aria-hidden
      />
      <div className={cn("relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-[var(--radius-xl)] border border-line bg-surface shadow-[var(--shadow-2)]", widths[width])}>
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="border-t border-line px-5 py-3.5">{footer}</footer>}
      </div>
    </div>
  );
}
