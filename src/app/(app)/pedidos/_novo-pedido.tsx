"use client";

import { createContext, useContext, useState } from "react";
import { PedidoFormSheetLazy, useFormOptions } from "./_form-options";

// ── Dono único do sheet "Novo pedido" ──────────────────────────
// O botão do cabeçalho (`ComprasAcoes`) e o estado vazio da lista
// (`PurchaseOrdersClient`) são componentes irmãos — sem isto, cada um
// acabava com sua própria instância de `PedidoFormSheet`, duplicada.

const AbrirNovoPedidoContext = createContext<(() => void) | null>(null);

export function useAbrirNovoPedido(): () => void {
  const abrir = useContext(AbrirNovoPedidoContext);
  if (!abrir) throw new Error("useAbrirNovoPedido precisa estar dentro de NovoPedidoProvider");
  return abrir;
}

export function NovoPedidoProvider({
  empresa,
  children,
}: {
  empresa: string;
  children: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const { garantir } = useFormOptions();

  return (
    <AbrirNovoPedidoContext.Provider
      value={() => {
        // Pede o catálogo junto com a abertura — o sheet já sobe carregando.
        garantir();
        setAberto(true);
      }}
    >
      {children}

      <PedidoFormSheetLazy
        open={aberto}
        onClose={() => setAberto(false)}
        mode="novo"
        empresa={empresa}
        onDone={() => setAberto(false)}
      />
    </AbrirNovoPedidoContext.Provider>
  );
}
