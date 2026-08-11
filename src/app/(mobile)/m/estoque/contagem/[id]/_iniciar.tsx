"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { iniciarInventarioAction } from "@/app/(app)/estoque/actions";

/**
 * Porta de entrada de um inventário PROGRAMADO no celular.
 *
 * Iniciar não é detalhe de implementação: é o instante em que o sistema
 * FOTOGRAFA o saldo de cada produto do escopo. Fazer isso sozinho, ao abrir a
 * tela, congelaria o saldo de quem só entrou para ver o que ia contar — e
 * qualquer venda entre a espiada e a contagem de verdade viraria divergência.
 * Por isso é um toque explícito.
 */
export function IniciarContagem({
  inventoryId,
  qtdProdutos,
  modoCego,
}: {
  inventoryId: string;
  qtdProdutos: number;
  modoCego: boolean;
}) {
  const router = useRouter();
  const [iniciando, setIniciando] = React.useState(false);

  async function iniciar() {
    setIniciando(true);
    try {
      await iniciarInventarioAction(inventoryId);
      // A mesma rota volta do servidor já com status ABERTO e os itens
      // resolvidos — a tela troca sozinha para a contagem.
      router.refresh();
    } catch (e) {
      setIniciando(false);
      toast.error(
        "Não foi possível iniciar",
        e instanceof Error ? e.message : "Tente de novo em instantes.",
      );
    }
  }

  return (
    <Card className="flex flex-col items-center gap-3 p-6 text-center">
      <ClipboardList className="h-8 w-8 text-muted" aria-hidden />
      <div>
        <p className="font-display text-base font-semibold text-ink">
          Pronto para contar
        </p>
        <p className="mt-1 text-sm text-ink-2">
          {qtdProdutos} {qtdProdutos === 1 ? "produto" : "produtos"} no escopo.
          {modoCego
            ? " A contagem é cega: o saldo do sistema só aparece no fechamento."
            : " Ao iniciar, o saldo atual de cada produto é congelado para comparação."}
        </p>
      </div>
      <Button onClick={iniciar} disabled={iniciando} size="lg" className="w-full">
        {iniciando && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {iniciando ? "Iniciando…" : "Iniciar contagem"}
      </Button>
    </Card>
  );
}
