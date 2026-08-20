import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { getActiveSiteId } from "@/lib/sites";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { loadPainelCompras } from "./_painel/data";
import { PainelComprasCliente } from "./_painel/client";

// Painel de Compras — dashboard operacional. O que comprar, de quem e quanto
// economizar. Configuração de fornecedor mora em /fornecedores/[id].

export default async function ComprasPainelPage() {
  const ctx = await requireActiveTenant();
  const policy = policyDoTenant(ctx.tenant);

  const dados = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    return loadPainelCompras(siteId, policy);
  });

  return (
    <PainelComprasCliente dados={dados} podePedir={podeEmAlguma(ctx.acessos, "compras.pedir")} />
  );
}
