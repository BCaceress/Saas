import { notFound } from "next/navigation";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { resumirCotacao } from "@/lib/compras/cotacao-resumo";
import { loadCotacao, loadOpcoes, loadReferenciasPreco } from "../_data";
import { CotacaoDetalheClient } from "./_client";

export default async function CotacaoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireActiveTenant();

  const dados = await withTenant(ctx, async () => {
    const cotacao = await loadCotacao(id);
    if (!cotacao) return null;
    const [opcoes, referencias] = await Promise.all([
      loadOpcoes(),
      loadReferenciasPreco(cotacao),
    ]);
    return { cotacao, opcoes, referencias };
  });

  if (!dados) notFound();

  // Resumo é derivação pura do que já foi carregado — roda no servidor para o
  // cliente receber texto pronto, não a regra.
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
    <CotacaoDetalheClient
      cotacao={dados.cotacao}
      produtos={dados.opcoes.produtos}
      fornecedores={dados.opcoes.fornecedores}
      resumo={resumo}
      podePedir={podeEmAlguma(ctx.acessos, "compras.pedir")}
    />
  );
}
