import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { loadTransferenciasAReceber } from "../estoque/_data";
import {
  loadAguardandoRecebimento,
  loadRecebimentos,
  loadFornecedoresComRecebimento,
  resumoRecebimentos,
  type AguardandoRow,
  type RecebimentoRow,
} from "./_lista";
import { filtrosDaUrl, mostraPedidos, paginaVazia, PEDIDOS_NO_TOPO, soPedidos } from "./_query";
import { RecebimentosView } from "./_lista-client";

// Recebimentos — o que chegou na loja. Cada linha é UM recebimento: o mesmo
// pedido aparece duas vezes quando veio em dois caminhões. Responde "o que
// chegou?", separada de "o que pedimos?" (/pedidos) e "que documento fiscal
// chegou?" (/fiscal/notas-recebidas).
//
// A tela abre em TODOS; o status é uma escolha só e as marcas (divergência,
// sem pedido, sem NF-e) restringem por cima. Pedidos aguardando e recebimentos
// são tabelas diferentes: na visão geral os pedidos sobem num bloco curto no
// topo e a lista paginada é a de recebimentos; em "Aguardando", a lista
// paginada passa a ser a de pedidos.

export default async function RecebimentosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireActiveTenant();
  const filtros = filtrosDaUrl(await searchParams);
  const apenasPedidos = soPedidos(filtros);
  // O bloco de pedidos no topo só existe na primeira página: repeti-lo a cada
  // página empurraria os recebimentos para baixo sem mostrar nada novo.
  const comPedidos = apenasPedidos || (mostraPedidos(filtros) && filtros.pagina === 1);
  const janela = { skip: (filtros.pagina - 1) * filtros.limite, take: filtros.limite };

  const dados = await withTenant(ctx, async () => {
    const activeSiteId = await getActiveSiteId();
    const [aguardando, recebimentos, fornecedores, resumo, transferencias, sites] = await Promise.all([
      comPedidos
        ? loadAguardandoRecebimento(
            filtros,
            apenasPedidos ? janela : { skip: 0, take: PEDIDOS_NO_TOPO },
          )
        : Promise.resolve(paginaVazia<AguardandoRow>(filtros)),
      apenasPedidos
        ? Promise.resolve(paginaVazia<RecebimentoRow>(filtros))
        : loadRecebimentos(filtros, janela),
      loadFornecedoresComRecebimento(),
      // O resumo é do TENANT, não da página: números que mudam a cada filtro
      // não são resumo, são ruído.
      resumoRecebimentos(),
      // Transferência entre lojas também é mercadoria chegando na doca —
      // morava em /pedidos, onde não é pedido de compra nenhum. Só cabe junto
      // de quem está esperando mercadoria.
      comPedidos ? loadTransferenciasAReceber(activeSiteId) : Promise.resolve([]),
      listSites(),
    ]);
    return { aguardando, recebimentos, fornecedores, resumo, transferencias, sites };
  });

  const transferenciasSerial = dados.transferencias.map((t) => ({
    ...t,
    expedidoEm: t.expedidoEm?.toISOString() ?? null,
  }));

  return (
    <RecebimentosView
      aguardando={dados.aguardando}
      recebimentos={dados.recebimentos}
      transferencias={transferenciasSerial}
      resumo={dados.resumo}
      fornecedores={dados.fornecedores}
      filtros={filtros}
      // Com uma loja só, a coluna diria a mesma coisa em todas as linhas.
      multiLoja={dados.sites.length > 1}
      podeReceber={podeEmAlguma(ctx.acessos, "compras.receber")}
      podeAvulso={podeEmAlguma(ctx.acessos, "estoque.ajustar")}
    />
  );
}
