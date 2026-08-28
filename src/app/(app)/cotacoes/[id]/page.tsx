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
    // As lojas não dependem da cotação: a consulta parte JUNTO com ela, em vez
    // de esperar na fila. São duas idas ao banco no tempo de uma.
    const sitesPromise = listSites();
    const cotacao = await loadCotacao(id, ctx.tenant);
    if (!cotacao) {
      // Consumida mesmo sem uso: promessa órfã vira "unhandled rejection".
      await sitesPromise.catch(() => []);
      return null;
    }
    const [fornecedores, sites, referencias, anterior, pedidos] = await Promise.all([
      loadFornecedoresOpcao(
        cotacao.itens.map((i) => i.productId).filter((id): id is string => !!id),
      ),
      sitesPromise,
      // Referência de preço alimenta o resumo do comparativo, que só existe
      // depois de a cotação sair. Em rascunho é uma varredura de histórico
      // para uma tela que ninguém vai ver.
      cotacao.status === "RASCUNHO" ? Promise.resolve({}) : loadReferenciasPreco(cotacao),
      // Molde para o estado vazio — só faz sentido enquanto a lista está vazia.
      cotacao.itens.length === 0 ? loadUltimaCotacaoComItens(id) : Promise.resolve(null),
      // Só depois de decidida existem pedidos: antes disso não há o que apontar.
      cotacao.status === "DECIDIDA" ? pedidosDaCotacao(id) : Promise.resolve([]),
    ]);

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
