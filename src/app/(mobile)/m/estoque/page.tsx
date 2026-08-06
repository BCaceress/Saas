import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { podeEmAlguma } from "@/lib/permissoes";
import { loadSaldos, contarVencimentos } from "@/app/(app)/estoque/_data";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { EstoqueClient } from "./_client";

/**
 * Saldos no celular. Aqui SIM `loadSaldos` é o carregador certo: a tela é a
 * lista inteira, que é exatamente o que ele entrega (diferente da ficha de um
 * produto, onde varrer o catálogo seria desperdício).
 *
 * Sem paginação de propósito: o operador filtra por chip ou busca pelo nome;
 * um mercadinho tem centenas de itens, não milhares, e rolagem infinita numa
 * lista que se filtra em dois toques só atrapalha.
 */
export default async function EstoqueMobilePage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string }>;
}) {
  const ctx = await requirePermissaoMobile("estoque.ver");
  const { filtro } = await searchParams;
  const policy = policyDoTenant(ctx.tenant);

  const { saldos, sites, siteId, vencimentos } = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const [saldos, sites, vencimentos] = await Promise.all([
      loadSaldos(siteId, policy),
      listSites(),
      contarVencimentos(siteId, ctx.tenant.validadeAlertaDias || 30),
    ]);
    return { saldos, sites, siteId, vencimentos };
  });

  return (
    <>
      <MobilePageHeader titulo="Estoque" descricao={`${saldos.length} itens`} />
      <EstoqueClient
        saldos={saldos}
        sites={sites.map((s) => ({ id: s.id, nome: s.nome }))}
        siteAtivo={siteId}
        policy={policy}
        filtroInicial={filtro ?? null}
        totalVencendo={vencimentos.vencidos + vencimentos.vencendo}
        podeAjustar={podeEmAlguma(ctx.acessos, "estoque.ajustar")}
        podeTransferir={podeEmAlguma(ctx.acessos, "estoque.transferir")}
      />
    </>
  );
}
