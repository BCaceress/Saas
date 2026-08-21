"use client";

import { useState } from "react";
import { FileUp, Plus } from "lucide-react";
import { useAbrirNovoPedido } from "./_novo-pedido";
import { ReceberMercadoriaPanel } from "./_receber-mercadoria";

// ── Ações do cabeçalho de Compras ─────────────────────────────
// "Novo pedido" cobre o pedido avulso (fora da sugestão de reposição) — o
// sheet em si é único, dono é `NovoPedidoProvider` (evita duplicar
// `PedidoFormSheet` entre este botão e o estado vazio da lista).
//
// "Receber mercadoria" morava numa tela própria (/recebimento), que só existia
// para hospedar este botão e uma fila de notas soltas. Mercadoria sempre chega
// CONTRA um pedido, então a porta é aqui: o painel abre no menu de 3 portas
// (XML / escanear / manual) e, depois do XML, a conferência abre em tela
// cheia — que é onde o trabalho de verdade acontece.

export function ComprasAcoes({ podeReceber }: { podeReceber: boolean }) {
  const abrirNovoPedido = useAbrirNovoPedido();
  const [recebendo, setRecebendo] = useState(false);

  return (
    <>
      {podeReceber && (
        <>
          <button
            type="button"
            onClick={() => setRecebendo(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2"
          >
            <FileUp size={15} className="text-muted" />
            <span className="hidden sm:inline">Receber mercadoria</span>
          </button>

          {/* Sem pedido escolhido: o painel abre na escolha das 3 portas, e o
              XML acha (ou cria) o pedido sozinho. Partindo de um card da lista
              o mesmo painel já entra direto no upload — ver _pedidos.tsx. */}
          <ReceberMercadoriaPanel
            pedido={null}
            etapaInicial="escolha"
            open={recebendo}
            onClose={() => setRecebendo(false)}
          />
        </>
      )}

      <button
        type="button"
        onClick={abrirNovoPedido}
        className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-sm font-semibold text-on-brand transition-colors hover:bg-brand-strong"
      >
        <Plus size={15} />
        <span className="hidden sm:inline">Novo pedido</span>
      </button>
    </>
  );
}
