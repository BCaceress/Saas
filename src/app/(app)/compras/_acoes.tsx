"use client";

import { useState } from "react";
import { History, Plus } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { ExtratoEntradas, type Evento } from "./_historico";
import { PedidoFormSheet, type FormOptions } from "./_pedidos";

// ── Ações do cabeçalho de Compras ─────────────────────────────
// Histórico sai da operação diária: vira um sidepanel secundário.
// "Novo pedido" cobre o pedido avulso (fora da sugestão de reposição).

export function ComprasAcoes({
  eventos,
  formOptions,
  empresa,
}: {
  eventos: Evento[];
  formOptions: FormOptions;
  empresa: string;
}) {
  const [historico, setHistorico] = useState(false);
  const [novo, setNovo] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setHistorico(true)}
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

      <Sheet
        open={historico}
        onClose={() => setHistorico(false)}
        title="Histórico de entradas"
        description="Tudo que já entrou no estoque — compras, transferências, ajustes e devoluções."
        width="2xl"
      >
        <ExtratoEntradas eventos={eventos} />
      </Sheet>

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
