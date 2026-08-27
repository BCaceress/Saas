import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { getActiveSiteId } from "@/lib/sites";
import { loadTransferenciasAReceber } from "../estoque/_data";
import {
  loadAguardandoRecebimento,
  loadRecebimentos,
  loadFornecedoresComRecebimento,
  resumoRecebimentos,
  type AguardandoRow,
  type RecebimentoRow,
} from "./_lista";
import { abaDePedidos, filtrosDaUrl, paginaVazia } from "./_query";
import { RecebimentosView } from "./_lista-client";

// Recebimentos — o que chegou na loja. Cada linha é UM recebimento: o mesmo
// pedido aparece duas vezes quando veio em dois caminhões. Responde "o que
// chegou?", separada de "o que pedimos?" (/pedidos) e "que documento fiscal
// chegou?" (/fiscal/notas-recebidas).
//
// UMA ABA POR VEZ: a página consulta o recorte selecionado e mais nenhum. Abrir
// a tela nunca lê o histórico de concluídos — ele cresce para sempre, e é
// exatamente a lista que ninguém precisa ver para começar o dia.

export default async function RecebimentosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireActiveTenant();
  const filtros = filtrosDaUrl(await searchParams);
  const abaPedidos = abaDePedidos(filtros.aba);
  const janela = { skip: (filtros.pagina - 1) * filtros.limite, take: filtros.limite };

  const dados = await withTenant(ctx, async () => {
    const activeSiteId = await getActiveSiteId();
    const [aguardando, recebimentos, fornecedores, resumo, transferencias] = await Promise.all([
      abaPedidos
        ? loadAguardandoRecebimento(filtros, janela)
        : Promise.resolve(paginaVazia<AguardandoRow>(filtros)),
      abaPedidos
        ? Promise.resolve(paginaVazia<RecebimentoRow>(filtros))
        : loadRecebimentos(filtros, janela),
      loadFornecedoresComRecebimento(),
      // O resumo é do TENANT, não da página: números que mudam a cada filtro
      // não são resumo, são ruído.
      resumoRecebimentos(),
      // Transferência entre lojas também é mercadoria chegando na doca —
      // morava em /pedidos, onde não é pedido de compra nenhum. Só cabe na aba
      // de quem está esperando mercadoria.
      abaPedidos ? loadTransferenciasAReceber(activeSiteId) : Promise.resolve([]),
    ]);
    return { aguardando, recebimentos, fornecedores, resumo, transferencias };
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
      podeReceber={podeEmAlguma(ctx.acessos, "compras.receber")}
      podeAvulso={podeEmAlguma(ctx.acessos, "estoque.ajustar")}
    />
  );
}
