import { notFound } from "next/navigation";
import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { loadCotacao, loadFornecedoresOpcao } from "@/app/(app)/cotacoes/_compra-data";
import { CotacaoMobileDetalhe } from "./_client";

/**
 * Uma cotação, do celular.
 *
 * O catálogo inteiro NÃO vem: no desktop a lista de produtos alimenta um
 * `<select>`, aqui o produto entra por bipe ou busca (`buscarPorNomeAction`),
 * então carregar milhares de linhas seria pagar por uma lista que ninguém rola
 * na gôndola. Fornecedores vêm — são dezenas, e escolher quem recebe é um
 * passo do fluxo.
 */
export default async function CotacaoMobilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermissaoMobile("compras.ver");

  const dados = await withTenant(ctx, async () => {
    const cotacao = await loadCotacao(id);
    if (!cotacao) return null;
    const fornecedores = await loadFornecedoresOpcao();
    return { cotacao, fornecedores };
  });

  if (!dados) notFound();

  return (
    <CotacaoMobileDetalhe
      cotacao={dados.cotacao}
      fornecedores={dados.fornecedores}
      podePedir={podeEmAlguma(ctx.acessos, "compras.pedir")}
    />
  );
}
