import { notFound } from "next/navigation";
import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { db } from "@/lib/prisma";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { FichaProdutoView, AcoesFicha } from "@/components/mobile/ficha-produto";
import { montarFicha, SELECT_FICHA, type ProdutoCru } from "../../_produto-data";

/**
 * Ficha do produto por link direto — vem da busca por nome, de um alerta ou de
 * um atalho salvo. O mesmo conteúdo do resultado do scanner, só que renderizado
 * no servidor: aqui não há câmera envolvida, então não há motivo para o
 * cliente pagar por uma ida a mais.
 */
export default async function ProdutoMobilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermissaoMobile("produto.ver");
  const policy = policyDoTenant(ctx.tenant);

  const ficha = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    // `findFirst` e não `findUnique`: o extension injeta tenantId no WHERE e
    // findUnique só aceita campos únicos (ver CLAUDE.md).
    const produto = (await db.product.findFirst({
      where: { id },
      select: SELECT_FICHA,
    })) as ProdutoCru | null;
    if (!produto) return null;

    return montarFicha(produto, {
      acessos: ctx.acessos,
      siteId,
      policy,
      validadeAlertaDias: ctx.tenant.validadeAlertaDias || 30,
      casouPor: "id",
    });
  });

  if (!ficha) notFound();

  return (
    <>
      <MobilePageHeader titulo="Produto" voltar="/m/scan" />
      <div className="space-y-3">
        <FichaProdutoView ficha={ficha} />
        <AcoesFicha ficha={ficha} />
      </div>
    </>
  );
}
