import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { podeEmAlguma } from "@/lib/permissoes";
import { contarVencimentos } from "@/app/(app)/estoque/_data";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { loadSaldosMobile } from "./_data";
import { EstoqueClient } from "./_client";

/**
 * Saldos no celular.
 *
 * Usa `loadSaldosMobile` (ver `_data.ts`), não o `loadSaldos` do desktop: a
 * lista aqui mostra doze campos e aquele carrega a linha completa da tela de
 * mesa — cinco consultas, uma varredura de 5.000 movimentos e objetos
 * aninhados que desceriam inteiros no payload para ninguém ler.
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
      loadSaldosMobile(siteId, policy),
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
        // Com um local só não há para onde transferir — o botão viraria uma
        // folha com o seletor de destino vazio.
        podeTransferir={sites.length > 1 && podeEmAlguma(ctx.acessos, "estoque.transferir")}
      />
    </>
  );
}
