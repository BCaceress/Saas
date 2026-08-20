"use client";

import { useState } from "react";
import { FileUp } from "lucide-react";
import { ReceberMercadoriaPanel } from "../pedidos/_receber-mercadoria";

// ── Ações do cabeçalho de Recebimentos ────────────────────────
// Entrada a partir daqui não parte de um pedido específico, então o painel
// abre no menu de 3 portas (XML/escanear/manual) — diferente do atalho em
// Pedidos, que já pula direto para o upload de XML.

export function RecebimentoAcoes() {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
      >
        <FileUp size={15} />
        <span className="hidden sm:inline">Receber mercadoria</span>
      </button>

      <ReceberMercadoriaPanel
        pedido={null}
        etapaInicial="escolha"
        open={aberto}
        onClose={() => setAberto(false)}
      />
    </>
  );
}
