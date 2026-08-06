import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { loadPedidosCompra } from "@/app/(app)/estoque/_data";
import { loadCotacoes } from "@/app/(app)/compras/cotacoes/_data";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { AprovacoesClient } from "./_client";

/** Pedidos e cotações que esperam uma decisão do dono — não um cadastro. */
export default async function AprovacoesPage() {
  const ctx = await requirePermissaoMobile("compras.pedir");

  const { pedidos, cotacoes } = await withTenant(ctx, async () => {
    const [todos, cot] = await Promise.all([loadPedidosCompra(), loadCotacoes()]);
    return {
      // Rascunho espera envio; enviado/aguardando esperam confirmação do
      // fornecedor. O resto já é operação de recebimento, que mora em /m/receber.
      pedidos: todos.filter((p) =>
        ["RASCUNHO", "ENVIADO", "AGUARDANDO"].includes(p.status),
      ),
      cotacoes: cot.linhas.filter((c) => c.status === "ABERTA" || c.status === "ENCERRADA"),
    };
  });

  return (
    <>
      <MobilePageHeader titulo="Aprovações" descricao="Decisões de um toque." />
      <AprovacoesClient pedidos={pedidos} cotacoes={cotacoes} />
    </>
  );
}
