import type { ReconciliationStatus } from "@/generated/prisma";

// ============================================================
// As regras de comparação da conciliação — puras, sem I/O.
//
// Separadas do serviço pelo mesmo motivo que `fiscal/fator.ts`: o veredito de
// uma linha ("faltou", "mudou de preço") é a parte que precisa estar CERTA, e
// certeza aqui se prova com teste, não com clique na tela.
//
// Tudo em UNIDADE BASE do estoque: converter é responsabilidade de quem chama.
// ============================================================

/** Quantidade é contagem: meia unidade de diferença não existe. */
export const TOL_QTD = 0.001;
/** Diferença de custo abaixo disso é arredondamento de rateio, não preço novo. */
export const TOL_CUSTO_ABS = 0.005;
export const TOL_CUSTO_REL = 0.005;

/**
 * Termo com que a busca de produto abre ao relacionar um item da nota: o NOME
 * do item, como o fornecedor escreveu.
 *
 * Só as primeiras palavras. A descrição da NF-e termina em embalagem e lastro
 * ("CERV HEINEKEN LN 330ML CX C/24") e a linha inteira não casa com nada no
 * catálogo — enquanto "CERV HEINEKEN LN" casa. SKU e código de barras seguem
 * valendo na mesma caixa: quem digita, busca.
 */
export function termoDeBuscaDoItem(descricao: string): string {
  return descricao.trim().split(/\s+/).slice(0, 3).join(" ").slice(0, 30);
}

/** O custo faturado difere do negociado a ponto de exigir decisão do operador? */
export function custoMudou(custoPedido: number, custoFaturado: number): boolean {
  // Sem preço negociado (bonificação, item fora do pedido) não há comparação.
  if (custoPedido <= 0) return false;
  const dif = Math.abs(custoFaturado - custoPedido);
  return dif > TOL_CUSTO_ABS && dif / custoPedido > TOL_CUSTO_REL;
}

/** Variação percentual do custo. `null` quando não há o que comparar. */
export function variacaoCusto(custoPedido: number, custoFaturado: number): number | null {
  if (custoPedido <= 0) return null;
  const v = ((custoFaturado - custoPedido) / custoPedido) * 100;
  return Math.abs(v) < 0.01 ? null : v;
}

/**
 * Veredito de uma linha que tem os dois lados (pedido e nota).
 *
 * Quantidade vem antes de preço de propósito: faltar mercadoria é um problema
 * de outra ordem que pagar 9% a mais por ela, e a tela só mostra um selo.
 */
export function vereditoDaLinha(l: {
  qtdPedida: number;
  qtdFaturada: number;
  custoPedido: number;
  custoFaturado: number;
}): ReconciliationStatus {
  const dif = l.qtdFaturada - l.qtdPedida;
  if (dif < -TOL_QTD) return "FALTANDO";
  if (dif > TOL_QTD) return "EXCEDENTE";
  if (custoMudou(l.custoPedido, l.custoFaturado)) return "PRECO_ALTERADO";
  return "OK";
}

// ── Pareamento nota × pedido ─────────────────────────────────

/** Uma linha do pedido como a conciliação a enxerga — já em unidade base. */
export type ItemDoPedidoConciliado = {
  id: string;
  productId: string;
  /** COMPRA (true) ou entrada sem custo — bonificação, brinde, troca… */
  compra: boolean;
  /**
   * O que AINDA falta chegar deste item, em unidade base. Não o total pedido:
   * a segunda entrega de um pedido de 100 que já recebeu 60 espera 40.
   */
  saldo: number;
  /** Preço negociado por unidade base. */
  custoBase: number;
};

/** Uma linha da nota, já em unidade base e com o custo cheio. */
export type ItemDaNotaConciliado = {
  id: string;
  productId: string | null;
  bonificacao: boolean;
  qtdBase: number;
  custoBase: number;
};

/** O esqueleto de uma linha da conferência — sem nome nem código, que são da tela. */
export type LinhaPlanejada = {
  inboundItemId: string | null;
  purchaseOrderItemId: string | null;
  productId: string | null;
  qtdPedida: number;
  qtdFaturada: number;
  custoPedido: number;
  custoFaturado: number;
  bonificacao: boolean;
  status: ReconciliationStatus;
};

/**
 * Casa as linhas da nota com as do pedido e diz o veredito de cada uma.
 *
 * Por produto, nunca por posição: o fornecedor reordena as linhas, quebra uma
 * linha em duas (lotes diferentes) e manda bonificação no meio.
 *
 *  - Linha comprada casa com linha comprada; bonificada, com bonificada. Só o
 *    que sobrar sem par do mesmo tipo tenta o outro tipo — antes, a ordem da
 *    nota decidia: uma caixa de brinde listada primeiro consumia a linha
 *    comprada, e a compra de verdade virava "fora do pedido".
 *  - Uma linha do pedido pode ser faturada em várias linhas da nota. O saldo é
 *    repartido na ordem da nota e a última leva o resto — pedido de 120 em
 *    duas linhas de 60 dá duas linhas OK, não "faltam 60" + "fora do pedido".
 *  - O que a nota não trouxe e ainda tem saldo vira NAO_FATURADO. O que já
 *    chegou numa entrega anterior não vira linha nenhuma: não é falta desta
 *    nota, e listá-lo fazia a conferência esperar de novo o que já entrou.
 */
export function planejarConciliacao(
  pedido: ItemDoPedidoConciliado[],
  nota: ItemDaNotaConciliado[],
): LinhaPlanejada[] {
  const restante = new Map(pedido.map((p) => [p.id, Math.max(0, p.saldo)]));
  const par = new Map<string, ItemDoPedidoConciliado>(); // item da nota → item do pedido
  const casados = new Set<string>(); // itens do pedido com algum par

  // 1. Mesmo tipo. Prefere quem ainda tem saldo; repete a linha do pedido
  //    quando a nota quebrou a entrega em lotes.
  for (const item of nota) {
    if (!item.productId) continue;
    const mesmoTipo = pedido.filter(
      (p) => p.productId === item.productId && p.compra === !item.bonificacao,
    );
    const escolhido =
      mesmoTipo.find((p) => (restante.get(p.id) ?? 0) > TOL_QTD) ??
      mesmoTipo.find((p) => !casados.has(p.id)) ??
      mesmoTipo[0];
    if (!escolhido) continue;
    par.set(item.id, escolhido);
    casados.add(escolhido.id);
    restante.set(escolhido.id, Math.max(0, (restante.get(escolhido.id) ?? 0) - item.qtdBase));
  }

  // 2. Outro tipo, só para quem sobrou: o pedido comprou e o fornecedor mandou
  //    de graça (ou o contrário). Uma linha do pedido, um par.
  for (const item of nota) {
    if (!item.productId || par.has(item.id)) continue;
    const escolhido = pedido.find((p) => p.productId === item.productId && !casados.has(p.id));
    if (!escolhido) continue;
    par.set(item.id, escolhido);
    casados.add(escolhido.id);
  }

  // 3. Reparte o saldo de cada linha do pedido entre as linhas da nota que a
  //    faturaram, na ordem da nota; a última fica com o resto.
  const doPedido = new Map<string, ItemDaNotaConciliado[]>();
  for (const item of nota) {
    const p = par.get(item.id);
    if (!p) continue;
    doPedido.set(p.id, [...(doPedido.get(p.id) ?? []), item]);
  }
  const esperadoPeloPedido = new Map<string, number>();
  for (const [pedidoId, itens] of doPedido) {
    let resto = Math.max(0, pedido.find((p) => p.id === pedidoId)?.saldo ?? 0);
    itens.forEach((item, i) => {
      const parte = i === itens.length - 1 ? resto : Math.min(item.qtdBase, resto);
      esperadoPeloPedido.set(item.id, parte);
      resto = Math.max(0, resto - parte);
    });
  }

  const linhas: LinhaPlanejada[] = nota.map((item) => {
    const p = par.get(item.id) ?? null;
    const qtdPedida = p ? (esperadoPeloPedido.get(item.id) ?? 0) : 0;
    const custoPedido = p?.custoBase ?? 0;
    return {
      inboundItemId: item.id,
      purchaseOrderItemId: p?.id ?? null,
      productId: item.productId,
      qtdPedida,
      qtdFaturada: item.qtdBase,
      custoPedido,
      custoFaturado: item.custoBase,
      bonificacao: item.bonificacao,
      status: p
        ? vereditoDaLinha({
            qtdPedida,
            qtdFaturada: item.qtdBase,
            custoPedido,
            custoFaturado: item.custoBase,
          })
        : "NAO_PEDIDO",
    };
  });

  for (const p of pedido) {
    if (casados.has(p.id) || p.saldo <= TOL_QTD) continue;
    linhas.push({
      inboundItemId: null,
      purchaseOrderItemId: p.id,
      productId: p.productId,
      qtdPedida: p.saldo,
      qtdFaturada: 0,
      custoPedido: p.custoBase,
      custoFaturado: 0,
      bonificacao: !p.compra,
      status: "NAO_FATURADO",
    });
  }

  return linhas;
}

// ── Remontar sem perder a contagem ───────────────────────────

/** O que a doca já escreveu numa linha — o que não pode sumir ao remontar. */
export type ConferenciaAnterior = {
  inboundItemId: string | null;
  purchaseOrderItemId: string | null;
  status: string;
  qtdRecebida: unknown;
  lote: string | null;
  validade: unknown;
  resolucao: string | null;
  motivoDivergencia: string | null;
  /** A contagem repartida por lote (JSON) — viaja junto com a quantidade. */
  lotes?: unknown;
  /** Quem contou e quando: a contagem que muda de linha não muda de dono. */
  contadoPor?: string | null;
  contadoEm?: unknown;
};

/**
 * Carrega a contagem das linhas antigas para as novas.
 *
 * Relacionar um item ao catálogo no meio da conferência refaz as linhas, e
 * quem já contou trinta caixas não conta de novo. A linha da nota é
 * reconhecida pelo item do XML; a que só existe no pedido, pelo item do
 * pedido — e o recebimento aberto pelo pedido que só agora ganhou a nota
 * passa a contagem da linha do pedido para a linha da nota que a fatura
 * (uma vez só: a segunda linha da nota quebrada em lotes nasce sem contagem,
 * em vez de herdar o mesmo número).
 *
 * A DECISÃO sobre uma divergência (aceitar, ignorar, a frase do motivo) só
 * sobrevive quando a divergência é a mesma — linha que mudou de veredito
 * volta a pedir resposta.
 */
export function mesclarContagemAnterior<
  L extends { inboundItemId: string | null; purchaseOrderItemId: string | null; status: string },
  A extends ConferenciaAnterior,
>(
  novas: L[],
  anteriores: A[],
  opts: { decisaoSoComMesmoVeredito: boolean },
): (L & {
  qtdRecebida: A["qtdRecebida"] | null;
  lote: string | null;
  validade: A["validade"] | null;
  lotes: A["lotes"] | null;
  contadoPor: string | null;
  contadoEm: A["contadoEm"] | null;
  resolucao: A["resolucao"] | null;
  motivoDivergencia: string | null;
})[] {
  const porNota = new Map<string, A>();
  const porPedido = new Map<string, A>();
  for (const a of anteriores) {
    if (a.inboundItemId) porNota.set(a.inboundItemId, a);
    else if (a.purchaseOrderItemId) porPedido.set(a.purchaseOrderItemId, a);
  }

  return novas.map((l) => {
    let antes: A | null = null;
    if (l.inboundItemId) antes = porNota.get(l.inboundItemId) ?? null;
    if (!antes && l.purchaseOrderItemId) {
      antes = porPedido.get(l.purchaseOrderItemId) ?? null;
      if (antes) porPedido.delete(l.purchaseOrderItemId);
    }
    const valeDecisao =
      antes != null && (!opts.decisaoSoComMesmoVeredito || antes.status === l.status);
    return {
      ...l,
      qtdRecebida: antes?.qtdRecebida ?? null,
      lote: antes?.lote ?? null,
      validade: antes?.validade ?? null,
      lotes: antes?.lotes ?? null,
      contadoPor: antes?.contadoPor ?? null,
      contadoEm: antes?.contadoEm ?? null,
      resolucao: valeDecisao ? (antes?.resolucao ?? null) : null,
      motivoDivergencia: valeDecisao ? (antes?.motivoDivergencia ?? null) : null,
    };
  });
}

/** Linha que a doca abriu à mão ("Adicionar item"), sem nota e sem pedido. */
export type AvulsaAnterior = ConferenciaAnterior & {
  id: string;
  productId: string | null;
  bonificacao: boolean;
};

/**
 * A nota chegou com a carga já contada.
 *
 * Quem recebeu sem o XML abriu cada item à mão. Quando a nota é vinculada, as
 * linhas dela nascem sem contagem — e o mesmo produto aparecia duas vezes: a
 * linha da nota, vazia, e a avulsa, contada. Aqui a contagem da avulsa passa
 * para a linha da nota do mesmo produto e do mesmo tipo (brinde com brinde), e
 * a avulsa sai. Só a linha da nota ainda sem contagem recebe, e cada avulsa
 * vai para uma linha só — a primeira, como no repasse do pedido para a nota.
 *
 * Decisão sobre divergência não viaja: a avulsa era "fora do papel", a linha
 * da nota tem outro veredito e volta a pedir resposta se não bater.
 */
export function absorverAvulsas<
  L extends { productId: string | null; bonificacao: boolean; qtdRecebida: unknown },
>(novas: L[], avulsas: AvulsaAnterior[]): { linhas: L[]; absorvidas: string[] } {
  const livres = avulsas.filter((a) => a.productId && a.qtdRecebida != null);
  const absorvidas: string[] = [];
  const linhas = novas.map((l) => {
    if (l.qtdRecebida != null || !l.productId) return l;
    const i = livres.findIndex((a) => a.productId === l.productId && a.bonificacao === l.bonificacao);
    if (i < 0) return l;
    const [a] = livres.splice(i, 1);
    absorvidas.push(a.id);
    return {
      ...l,
      qtdRecebida: a.qtdRecebida,
      lote: a.lote,
      validade: a.validade,
      lotes: a.lotes ?? null,
      contadoPor: a.contadoPor ?? null,
      contadoEm: a.contadoEm ?? null,
    };
  });
  return { linhas, absorvidas };
}
