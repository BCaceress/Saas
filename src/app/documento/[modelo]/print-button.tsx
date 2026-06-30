"use client";

import { Printer, X } from "lucide-react";

/**
 * Ações flutuantes do documento — só na tela (escondidas na impressão via
 * `.no-print`). "Baixar PDF" usa o diálogo de impressão do navegador (Salvar
 * como PDF); zero dependência. Migrar para PDF binário (@react-pdf) é um upgrade
 * posterior sem mexer no resto.
 */
export function DocActions() {
  return (
    <div className="no-print fixed right-5 top-5 z-50 flex items-center gap-2">
      <button
        type="button"
        onClick={() => window.print()}
        className="flex items-center gap-2 rounded-full bg-[var(--brand,#0891b2)] px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-90"
      >
        <Printer size={16} />
        Baixar PDF
      </button>
      <button
        type="button"
        onClick={() => window.close()}
        aria-label="Fechar"
        className="grid h-10 w-10 place-items-center rounded-full border border-zinc-300 bg-white text-zinc-500 shadow-sm transition-colors hover:bg-zinc-100"
      >
        <X size={17} />
      </button>
    </div>
  );
}
