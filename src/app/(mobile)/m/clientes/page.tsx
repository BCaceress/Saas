import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { loadCustomerRows, loadCouponCandidates } from "@/app/(app)/clientes/_data";
import { ClientesMobileClient } from "./_client";

export const metadata = { title: "Clientes — NoHub Market" };

/**
 * Clientes no celular. Antes o item do menu caía direto na tela de mesa: uma
 * tabela com menu de três pontos por linha, painel lateral e formulário fiscal
 * inteiro — três coisas que num aparelho de 390px viram zoom e erro de toque.
 *
 * Os dados são os MESMOS do desktop (`clientes/_data`) e as escritas passam
 * pelas mesmas server actions — aqui muda só a forma: cartão em vez de linha,
 * painel que sobe de baixo, e as duas ações que o operador faz de pé no balcão
 * (chamar no WhatsApp, mandar cupom) a um toque.
 */
export default async function ClientesMobilePage() {
  const ctx = await requirePermissaoMobile("cliente.ver");

  const { rows, candidates } = await withTenant(ctx, async () => {
    const [rows, candidates] = await Promise.all([
      loadCustomerRows(),
      loadCouponCandidates(ctx.tenant.cupomDiasRisco),
    ]);
    return { rows, candidates };
  });

  return (
    <ClientesMobileClient
      rows={rows}
      candidates={candidates}
      cupomDiasRisco={ctx.tenant.cupomDiasRisco}
      tierThresholds={{
        bronze: ctx.tenant.tierBronzeMin,
        prata: ctx.tenant.tierPrataMin,
        ouro: ctx.tenant.tierOuroMin,
        diamante: ctx.tenant.tierDiamanteMin,
      }}
      podeEditar={podeEmAlguma(ctx.acessos, "cliente.editar")}
    />
  );
}
