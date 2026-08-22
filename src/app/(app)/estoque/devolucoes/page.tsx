import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { podeEmAlguma } from "@/lib/permissoes";
import { loadDevolucoes, loadDevolucaoFormOptions } from "./_data";
import { DevolucoesView } from "./_client";

// Devolução ao fornecedor. Fica em Estoque porque é onde a mercadoria some do
// saldo, mas o documento pertence a Compras — por isso aponta para o pedido, a
// nota e os títulos em aberto.

export default async function DevolucoesPage() {
  const ctx = await requireActiveTenant();
  const podeDevolver = podeEmAlguma(ctx.acessos, "compras.devolver");

  const { rows, opcoes, siteId } = await withTenant(ctx, async () => {
    const sid = await getActiveSiteId();
    const [rows, opcoes] = await Promise.all([loadDevolucoes(sid), loadDevolucaoFormOptions()]);
    return { rows, opcoes, siteId: sid };
  });

  return (
    <DevolucoesView
      rows={rows}
      sites={opcoes.sites}
      suppliers={opcoes.suppliers}
      siteId={siteId}
      podeDevolver={podeDevolver}
    />
  );
}
