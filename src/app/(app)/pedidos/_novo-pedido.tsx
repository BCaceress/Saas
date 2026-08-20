"use client";

import { createContext, useContext, useState } from "react";
import { PedidoFormSheet, type FormOptions } from "./_pedidos";

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
  formOptions,
  empresa,
  children,
}: {
  formOptions: FormOptions;
  empresa: string;
  children: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <AbrirNovoPedidoContext.Provider value={() => setAberto(true)}>
      {children}

      {aberto && (
        <PedidoFormSheet
          open
          onClose={() => setAberto(false)}
          mode="novo"
          formOptions={formOptions}
          empresa={empresa}
          onDone={() => setAberto(false)}
        />
      )}
    </AbrirNovoPedidoContext.Provider>
  );
}
