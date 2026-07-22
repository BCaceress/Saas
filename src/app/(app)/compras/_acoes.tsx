"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { PedidoFormSheet, type FormOptions } from "./_pedidos";

// ── Ações do cabeçalho de Compras ─────────────────────────────
// "Novo pedido" cobre o pedido avulso (fora da sugestão de reposição).

export function ComprasAcoes({ formOptions, empresa }: { formOptions: FormOptions; empresa: string }) {
  const [novo, setNovo] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setNovo(true)}
        className="flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
      >
        <Plus size={15} />
        <span className="hidden sm:inline">Novo pedido</span>
      </button>

      {novo && (
        <PedidoFormSheet
          open
          onClose={() => setNovo(false)}
          mode="novo"
          formOptions={formOptions}
          empresa={empresa}
          onDone={() => setNovo(false)}
        />
      )}
    </>
  );
}
