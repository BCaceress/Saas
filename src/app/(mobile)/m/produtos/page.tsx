import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { podeEmAlguma } from "@/lib/permissoes";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { loadProdutosLista } from "./_data";
import { ProdutosClient } from "./_client";

/**
 * Catálogo no celular — só consulta.
 *
 * Cadastrar e editar produto continua sendo trabalho de mesa: são dezenas de
 * campos (fiscal, embalagens, componentes, canais) que não cabem num aparelho
 * de mão sem virar formulário de doze telas. Aqui a pergunta é outra e curta:
 * "que produto é esse, quanto custa, tem no estoque" — a mesma que se faz de pé
 * na gôndola quando não se tem o código para bipar.
 *
 * O toque leva à ficha (`/m/produto/[id]`), que é a mesma tela do scanner: um
 * lugar só para ver produto no celular.
 */
export default async function ProdutosMobilePage() {
  const ctx = await requirePermissaoMobile("produto.ver");
  const podeVerPreco = podeEmAlguma(ctx.acessos, "produto.preco");

  const produtos = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    return loadProdutosLista(siteId, podeVerPreco);
  });

  const ativos = produtos.filter((p) => p.ativo).length;

  return (
    <>
      <MobilePageHeader
        titulo="Produtos"
        descricao={`${ativos} ${ativos === 1 ? "produto ativo" : "produtos ativos"}`}
      />
      <ProdutosClient produtos={produtos} />
    </>
  );
}
