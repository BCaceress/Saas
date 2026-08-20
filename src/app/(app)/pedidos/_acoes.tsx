"use client";

import { Plus } from "lucide-react";
import { useAbrirNovoPedido } from "./_novo-pedido";

// ── Ações do cabeçalho de Compras ─────────────────────────────
// "Novo pedido" cobre o pedido avulso (fora da sugestão de reposição) — o
// sheet em si é único, dono é `NovoPedidoProvider` (evita duplicar
// `PedidoFormSheet` entre este botão e o estado vazio da lista).

export function ComprasAcoes() {
  const abrirNovoPedido = useAbrirNovoPedido();

  return (
    <button
      type="button"
      onClick={abrirNovoPedido}
      className="flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
    >
      <Plus size={15} />
      <span className="hidden sm:inline">Novo pedido</span>
    </button>
  );
}
