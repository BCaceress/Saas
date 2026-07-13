"use client";

import { useState } from "react";
import { History, Plus } from "lucide-react";
import { useAbrirHistorico } from "./_historico-compras";
import { PedidoFormSheet, type FormOptions } from "./_pedidos";

// ── Ações do cabeçalho de Compras ─────────────────────────────
// "Histórico" abre o sidepanel exclusivo de Compras (estado vive no
// HistoricoComprasProvider, compartilhado com o link "Ver todo o
// histórico" da Atividade recente). "Novo pedido" cobre o pedido
// avulso (fora da sugestão de reposição).

export function ComprasAcoes({ formOptions, empresa }: { formOptions: FormOptions; empresa: string }) {
  const [novo, setNovo] = useState(false);
  const abrirHistorico = useAbrirHistorico();

  return (
    <>
      <button
        type="button"
        onClick={abrirHistorico}
        className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
      >
        <History size={15} className="text-muted" />
        <span className="hidden sm:inline">Histórico</span>
      </button>
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
