import { notFound } from "next/navigation";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { resumirCotacao } from "@/lib/compras/cotacao-resumo";
import { pedidosDaCotacao } from "@/lib/compras/cotacao-economia";
import {
  loadCotacao,
  loadFornecedoresOpcao,
  loadReferenciasPreco,
  loadUltimaCotacaoComItens,
} from "../_compra-data";
import { listSites } from "@/lib/sites";
import { CotacaoDetalheClient } from "./_client";

export default async function CotacaoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireActiveTenant();

  const dados = await withTenant(ctx, async () => {
    const cotacao = await loadCotacao(id, ctx.tenant);
    if (!cotacao) return null;
    const [fornecedores, sites, referencias, anterior] = await Promise.all([
      loadFornecedoresOpcao(
        cotacao.itens.map((i) => i.productId).filter((id): id is string => !!id),
      ),
      listSites(),
      loadReferenciasPreco(cotacao),
      // Molde para o estado vazio — só faz sentido enquanto a lista está vazia.
      cotacao.itens.length === 0 ? loadUltimaCotacaoComItens(id) : Promise.resolve(null),
    ]);
    // Só depois de decidida existem pedidos: antes disso não há o que apontar.
    const pedidos = cotacao.status === "DECIDIDA" ? await pedidosDaCotacao(id) : [];

    return {
      cotacao,
      fornecedores,
      sites: sites.map((s) => ({ id: s.id, nome: s.nome })),
      referencias,
      pedidos,
      anterior,
    };
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
      fornecedores={dados.fornecedores}
      sites={dados.sites}
      resumo={resumo}
      pedidos={dados.pedidos}
      anterior={dados.anterior}
      podePedir={podeEmAlguma(ctx.acessos, "compras.pedir")}
      usaMinimo={policyDoTenant(ctx.tenant).usaMinimo}
    />
  );
}
