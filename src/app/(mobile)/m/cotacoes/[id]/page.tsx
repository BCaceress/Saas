import { notFound } from "next/navigation";
import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import {
  loadCotacao,
  loadFornecedoresOpcao,
  loadReferenciasPreco,
} from "@/app/(app)/cotacoes/_compra-data";
import { resumirCotacao } from "@/lib/compras/cotacao-resumo";
import { pedidosDaCotacao } from "@/lib/compras/cotacao-economia";
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
    const cotacao = await loadCotacao(id, ctx.tenant);
    if (!cotacao) return null;
    const [fornecedores, referencias] = await Promise.all([
      loadFornecedoresOpcao(),
      loadReferenciasPreco(cotacao),
    ]);
    // Só depois de decidida existem pedidos: antes disso não há o que apontar.
    const pedidos = cotacao.status === "DECIDIDA" ? await pedidosDaCotacao(id) : [];
    return { cotacao, fornecedores, referencias, pedidos };
  });

  if (!dados) notFound();

  // Mesma leitura do desktop: o motor é determinístico e roda no servidor, o
  // celular recebe texto pronto.
  const resumo = resumirCotacao({
    itens: dados.cotacao.itens.map((i) => ({
      id: i.id,
      descricao: i.descricao,
      quantidade: i.quantidade,
      productId: i.productId,
    })),
    convites: dados.cotacao.convites.map((c) => ({
      id: c.id,
      supplierId: c.supplierId,
      supplierNome: c.supplierNome,
      status: c.status,
      frete: c.frete,
      prazoEntregaDias: c.prazoEntregaDias,
      respostas: c.respostas.map((r) => ({
        quotationItemId: r.quotationItemId,
        disponivel: r.disponivel,
        precoUnitario: r.precoUnitario,
      })),
    })),
    prazoResposta: dados.cotacao.prazoResposta,
    referencias: dados.referencias,
  });

  return (
    <CotacaoMobileDetalhe
      cotacao={dados.cotacao}
      fornecedores={dados.fornecedores}
      resumo={resumo}
      pedidos={dados.pedidos}
      podePedir={podeEmAlguma(ctx.acessos, "compras.pedir")}
    />
  );
}
