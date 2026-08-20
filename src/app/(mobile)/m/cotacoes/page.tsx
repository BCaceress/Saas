import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { loadCotacoes } from "@/app/(app)/cotacoes/_compra-data";
import { CotacoesMobile } from "./_client";

/**
 * Cotações no celular.
 *
 * O comprador de mercadinho não senta no computador para pedir preço — ele
 * decide isso de pé, na frente da gôndola vazia, e é do celular que ele manda a
 * mensagem para o fornecedor. Por isso o fluxo inteiro (montar, enviar,
 * acompanhar, comparar, virar pedido) existe aqui, não só a consulta.
 *
 * O domínio é o mesmo do desktop: mesmos loaders, mesmas Server Actions, mesmo
 * `Quotation`. O que muda é a superfície — passo a passo, alvo de polegar e
 * produto entrando por bipe em vez de lista.
 */
export default async function CotacoesMobilePage() {
  const ctx = await requirePermissaoMobile("compras.ver");
  const { linhas } = await withTenant(ctx, () => loadCotacoes());

  return (
    <>
      <MobilePageHeader
        titulo="Cotações"
        descricao="Peça preço a vários fornecedores."
        voltar="/m/mais"
      />
      <CotacoesMobile
        linhas={linhas}
        podePedir={podeEmAlguma(ctx.acessos, "compras.pedir")}
      />
    </>
  );
}
