"use client";

import { Plus } from "lucide-react";
import { useAbrirNovoPedido } from "./_novo-pedido";

// ── Ações do cabeçalho de Pedidos de Compra ───────────────────
//
// Uma só ação, e é de propósito: esta tela gerencia PEDIDOS. "Receber
// mercadoria" morava aqui e voltou para /recebimento, onde a operação tem
// fila, conferência e divergência próprias — ter duas portas para o mesmo
// recebimento é como a mesma carga entra duas vezes no estoque.
//
// O sheet do pedido é único e o dono é `NovoPedidoProvider`, para não
// duplicar `PedidoFormSheet` entre este botão e o estado vazio da lista.

export function ComprasAcoes() {
  const abrirNovoPedido = useAbrirNovoPedido();

  return (
    <button
      type="button"
      onClick={abrirNovoPedido}
      className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
    >
      <Plus size={15} />
      <span className="hidden sm:inline">Novo pedido</span>
    </button>
  );
}
