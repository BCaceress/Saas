"use client";

import { useState } from "react";
import { Inbox, Plus } from "lucide-react";
import { useAbrirNovoPedido } from "./_novo-pedido";
import { ReceberMercadoriaPanel } from "./_receber-mercadoria";

// ── Ações do cabeçalho de Compras ─────────────────────────────
// "Novo pedido" cobre o pedido avulso (fora da sugestão de reposição) — o
// sheet em si é único, dono é `NovoPedidoProvider` (evita duplicar
// `PedidoFormSheet` entre este botão e o estado vazio da lista).
// "Receber sem pedido" cobre a mercadoria que chegou sem um pedido nosso —
// o painel decide sozinho, pelo XML, se acha o pedido ou cria um novo.

export function ComprasAcoes() {
  const abrirNovoPedido = useAbrirNovoPedido();
  const [receberSemPedido, setReceberSemPedido] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setReceberSemPedido(true)}
        className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
      >
        <Inbox size={15} className="text-muted" />
        <span className="hidden sm:inline">Receber sem pedido</span>
      </button>

      <button
        type="button"
        onClick={abrirNovoPedido}
        className="flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
      >
        <Plus size={15} />
        <span className="hidden sm:inline">Novo pedido</span>
      </button>

      <ReceberMercadoriaPanel
        pedido={null}
        open={receberSemPedido}
        onClose={() => setReceberSemPedido(false)}
      />
    </>
  );
}
