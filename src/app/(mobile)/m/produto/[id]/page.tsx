import { notFound } from "next/navigation";
import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { db } from "@/lib/prisma";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { FichaProdutoView, AcoesFicha } from "@/components/mobile/ficha-produto";
import { acaoDaUrl } from "@/components/mobile/acao-url";
import { montarFicha, SELECT_FICHA, type ProdutoCru } from "../../_produto-data";

/**
 * Para onde o "voltar" leva. O padrão é a LISTA DE PRODUTOS — é de lá que quase
 * toda visita chega, e antes o botão devolvia todo mundo ao scanner, inclusive
 * quem nunca abriu a câmera. Quem vem de outro lugar passa `?de=`; só caminhos
 * do próprio `/m` são aceitos, para o parâmetro não virar redirecionamento
 * aberto.
 */
function voltarPara(de: string | undefined): string {
  return de && /^\/m(\/|$)/.test(de) ? de : "/m/produtos";
}

/**
 * Ficha do produto por link direto — vem da busca por nome, de um alerta ou de
 * um atalho salvo. O mesmo conteúdo do resultado do scanner, só que renderizado
 * no servidor: aqui não há câmera envolvida, então não há motivo para o
 * cliente pagar por uma ida a mais.
 */
export default async function ProdutoMobilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ de?: string; acao?: string }>;
}) {
  const { id } = await params;
  const { de, acao } = await searchParams;
  const intencao = acaoDaUrl(acao);
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
      <MobilePageHeader titulo="Produto" voltar={voltarPara(de)} />
      <div className="space-y-3">
        <FichaProdutoView ficha={ficha} />
        {/* A intenção sobrevive ao desvio pela lista "qual deles?": quem veio
            registrar perda cai aqui com a folha da perda já aberta. */}
        <AcoesFicha ficha={ficha} inicial={intencao ? { chave: intencao } : null} />
      </div>
    </>
  );
}
