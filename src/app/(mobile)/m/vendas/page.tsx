import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { togglesEfetivos } from "@/lib/planos";
import { podeEmAlguma } from "@/lib/permissoes";
import {
  resumoVendas,
  mixPagamento,
  vendasPorDia,
  vendasPorHora,
  type Range,
} from "@/app/(app)/relatorios/_data";
import { loadVendasRecentes } from "@/app/(app)/vendas/_data";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { resolvePeriodoVendas, paraInput } from "./_periodo";
import { VendasClient, SeletorPeriodo } from "./_client";

/**
 * O movimento da loja, no bolso.
 *
 * Abre em HOJE e responde "está vendendo bem?" sem abrir relatório: total,
 * ticket, mix de pagamento, curva do movimento e as últimas vendas. O período é
 * regulável (ontem, semana, mês, intervalo próprio) com teto de 30 dias — acima
 * disso a pergunta deixa de ser de balcão e vira relatório, que tem tela
 * própria. O PDV NÃO vem: registrar venda é trabalho de balcão, com gaveta e
 * leitor, não de celular.
 */
export default async function VendasMobilePage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; de?: string; ate?: string }>;
}) {
  const ctx = await requirePermissaoMobile("relatorio.ver");
  const toggles = togglesEfetivos(ctx.tenant);
  const sp = await searchParams;
  const periodo = resolvePeriodoVendas(sp);
  const range: Range = { inicio: periodo.inicio, fim: periodo.fim };

  // Um dia só se lê por hora ("o movimento já veio?"); vários dias se leem por
  // dia — 30 dias × 24 barras não caberia em 390px de largura.
  const porHora = periodo.dias === 1;

  const dados = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const [resumo, mix, serie, recentes] = await Promise.all([
      resumoVendas(range, siteId),
      mixPagamento(range, siteId),
      porHora ? vendasPorHora(range, siteId) : vendasPorDia(range, siteId),
      loadVendasRecentes(siteId, 20, range),
    ]);
    return { resumo, mix, serie, recentes, siteId };
  });

  return (
    <>
      <MobilePageHeader
        titulo="Vendas"
        descricao={<span className="tabular-nums">{periodo.labelLongo}</span>}
        acao={
          <SeletorPeriodo
            // Remonta a cada troca de período: é o que fecha o menu (e apaga a
            // rodinha) no instante em que os números novos chegam, sem efeito
            // sincronizando estado de fora.
            key={`${sp.p ?? ""}|${sp.de ?? ""}|${sp.ate ?? ""}`}
            preset={periodo.preset}
            label={periodo.label}
            de={paraInput(periodo.inicio)}
            ate={paraInput(new Date(periodo.fim.getTime() - 86_400_000))}
          />
        }
      />
      <VendasClient
        resumo={dados.resumo}
        mix={dados.mix}
        serie={dados.serie}
        granularidade={porHora ? "hora" : "dia"}
        periodoLabel={periodo.label}
        incluiHoje={periodo.incluiHoje}
        recentes={dados.recentes}
        siteId={dados.siteId}
        autoatendimento={toggles.moduloAutoatendimento}
        podeRegistrar={podeEmAlguma(ctx.acessos, "venda.registrar")}
      />
    </>
  );
}
