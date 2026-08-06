import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { resolvePeriodo } from "@/lib/periodo";
import { togglesEfetivos } from "@/lib/planos";
import { podeEmAlguma } from "@/lib/permissoes";
import {
  resumoVendas,
  mixPagamento,
  vendasPorHora,
  type Range,
} from "@/app/(app)/relatorios/_data";
import { loadVendasRecentes } from "@/app/(app)/vendas/_data";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { VendasClient } from "./_client";

/**
 * O movimento de hoje, no bolso.
 *
 * Responde "está vendendo bem?" sem abrir relatório: total, ticket, mix de
 * pagamento, curva por hora e as últimas vendas. O PDV NÃO vem — registrar
 * venda é trabalho de balcão, com gaveta e leitor, não de celular.
 */
export default async function VendasMobilePage() {
  const ctx = await requirePermissaoMobile("relatorio.ver");
  const toggles = togglesEfetivos(ctx.tenant);
  const periodo = resolvePeriodo({ periodo: "hoje" });
  const range: Range = { inicio: periodo.inicio, fim: periodo.fim };

  const dados = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const [resumo, mix, porHora, recentes] = await Promise.all([
      resumoVendas(range, siteId),
      mixPagamento(range, siteId),
      vendasPorHora(range, siteId),
      loadVendasRecentes(siteId, 20),
    ]);
    return { resumo, mix, porHora, recentes, siteId };
  });

  return (
    <>
      <MobilePageHeader titulo="Vendas" descricao="Hoje, em tempo real." />
      <VendasClient
        resumo={dados.resumo}
        mix={dados.mix}
        porHora={dados.porHora}
        recentes={dados.recentes}
        siteId={dados.siteId}
        autoatendimento={toggles.moduloAutoatendimento}
        podeRegistrar={podeEmAlguma(ctx.acessos, "venda.registrar")}
        podeCancelar={podeEmAlguma(ctx.acessos, "venda.cancelar")}
      />
    </>
  );
}
