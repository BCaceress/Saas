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
  loadDatasLinhaDoTempo,
  loadUltimaCotacaoComItens,
} from "../_compra-data";
import { montarLinhaDoTempo } from "@/lib/compras/cotacao-linha-do-tempo";
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
    const [fornecedores, sites, referencias, anterior, pedidos, datas] = await Promise.all([
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
      // Pedido só nasce da conclusão — mas sobrevive à reabertura. Consultar
      // apenas em DECIDIDA escondia justamente o caso perigoso: cotação
      // reaberta com rascunho de pedido pendurado, que é o que o operador
      // precisa ver antes de mexer na pergunta de novo.
      cotacao.status === "RASCUNHO" ? Promise.resolve([]) : pedidosDaCotacao(id),
      // Linha do tempo só existe depois do envio — rascunho não tem história.
      cotacao.status === "RASCUNHO" ? Promise.resolve(null) : loadDatasLinhaDoTempo(id),
    ]);

    return {
      cotacao,
      fornecedores,
      sites: sites.map((s) => ({ id: s.id, nome: s.nome })),
      referencias,
      pedidos,
      anterior,
      datas,
    };
  });

  if (!dados) notFound();

  const linhaDoTempo = dados.datas
    ? montarLinhaDoTempo({
        criadaEm: dados.cotacao.criadaEm,
        geradaPorRecorrencia: dados.cotacao.geradaPorRecorrencia,
        encerradaEm: dados.datas.encerradaEm,
        decididaEm: dados.datas.decididaEm,
        canceladaEm: dados.datas.canceladaEm,
        convites: dados.cotacao.convites.map((c) => ({
          id: c.id,
          supplierNome: c.supplierNome,
          status: c.status,
          abertoEm: c.abertoEm,
          respondidaEm: c.respondidaEm,
          origemResposta: c.origemResposta,
          observacao: c.observacao,
          envios: c.envios,
        })),
        pedidos: dados.pedidos.flatMap((p) => {
          const d = dados.datas!.pedidos.get(p.id);
          return d ? [{ ...p, ...d }] : [];
        }),
      })
    : [];

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
      referencias={dados.referencias}
      linhaDoTempo={linhaDoTempo}
      pedidos={dados.pedidos}
      anterior={dados.anterior}
      podePedir={podeEmAlguma(ctx.acessos, "compras.pedir")}
      usaMinimo={policyDoTenant(ctx.tenant).usaMinimo}
    />
  );
}
