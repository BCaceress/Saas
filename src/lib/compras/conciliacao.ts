import "server-only";
import { db } from "@/lib/prisma";
import {
  criarPedidoCompra,
  registrarDevolucao,
  registrarEntrada,
  type EntradaItem,
} from "@/lib/estoque";
import { custoDoItem } from "@/lib/fiscal/custo";
import { unidadesDaLinha } from "@/lib/fiscal/unidades";
import { atualizarCustoDeReferencia } from "@/lib/fiscal/enriquecer-produto";
import { registrarEvento } from "./eventos";
import { gerarTitulosDaNota } from "@/lib/financeiro/contas-pagar";
import { TOL_QTD, vereditoDaLinha } from "./conciliacao-regras";
import type {
  PurchaseOrderStatus,
  ReconciliationResolucao,
  ReconciliationStatus,
} from "@/generated/prisma";

// ============================================================
// Conciliação em três camadas.
//
//   1. Pedido NoHub       — o que eu comprei
//   2. XML da NF-e        — o que o fornecedor faturou
//   3. Conferência física — o que realmente entrou
//
// O estoque só se move na camada 3. As duas primeiras existem para que a
// terceira seja quase só confirmar: quem está na porta confere mercadoria,
// não digita nota.
//
// TUDO aqui trabalha em UNIDADE BASE do estoque. O pedido fala em caixa, a
// nota fala em fardo — comparar sem converter é o erro que faz "10 caixas"
// virar uma divergência de "120 unidades". A conversão acontece uma vez, na
// entrada desta camada, e nunca mais.
//
// Todas as funções assumem contexto de tenant ativo (runWithTenant no chamador).
// ============================================================

/** Status de pedido que ainda esperam mercadoria — candidatos a receber um XML. */
const PEDIDOS_ABERTOS: PurchaseOrderStatus[] = [
  "ENVIADO",
  "AGUARDANDO",
  "EM_TRANSITO",
  "CONFERENCIA",
  "RECEBIDO_PARCIAL",
];

// ── Sugestão de pedido ───────────────────────────────────────

export type SugestaoPedido = {
  purchaseOrderId: string;
  numero: string;
  status: PurchaseOrderStatus;
  valorTotal: number;
  itens: number;
  criadoEm: Date;
  score: number;
  /** Por que este pedido foi sugerido — vai inteiro para a tela. */
  motivos: string[];
};

/** Score mínimo para vincular sozinho, sem perguntar. */
const SCORE_AUTOMATICO = 60;
/** Distância mínima para o segundo colocado — empate técnico o operador decide. */
const MARGEM_AUTOMATICA = 20;

const soLetrasNumeros = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Ordena os pedidos em aberto do fornecedor por quanto cada um se parece com
 * esta nota. Critérios, do mais forte ao mais fraco:
 *
 *   1. a própria nota cita o número do pedido (xPed) — resposta direta;
 *   2. os produtos faturados são os produtos pedidos;
 *   3. o valor da nota bate com o do pedido;
 *   4. as datas são compatíveis (nota depois do pedido, dentro do prazo usual).
 *
 * Nada aqui inventa vínculo: quem decide se o topo da lista vira vínculo
 * automático é `conciliarComPedidoSugerido`.
 */
export async function sugerirPedidos(inboundId: string): Promise<SugestaoPedido[]> {
  const inbound = await db.fiscalInbound.findFirst({
    where: { id: inboundId },
    select: {
      siteId: true,
      supplierId: true,
      dataEmissao: true,
      valorTotal: true,
      items: {
        select: { productId: true, pedidoFornecedor: true, quantidade: true, fatorConversao: true },
      },
    },
  });
  if (!inbound?.supplierId) return [];

  const candidatos = await db.purchaseOrder.findMany({
    where: {
      supplierId: inbound.supplierId,
      siteId: inbound.siteId,
      status: { in: PEDIDOS_ABERTOS },
    },
    select: {
      id: true,
      numero: true,
      status: true,
      valorTotal: true,
      createdAt: true,
      items: { select: { productId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  if (candidatos.length === 0) return [];

  const citados = new Set(
    inbound.items
      .map((i) => i.pedidoFornecedor)
      .filter((p): p is string => Boolean(p && p.trim()))
      .map(soLetrasNumeros),
  );
  const produtosNota = new Set(
    inbound.items.map((i) => i.productId).filter((p): p is string => Boolean(p)),
  );
  const valorNota = Number(inbound.valorTotal);

  const sugestoes = candidatos.map((po): SugestaoPedido => {
    const motivos: string[] = [];
    let score = 0;

    // 1. A nota cita o pedido. É a pista mais forte que existe.
    const numeroLimpo = soLetrasNumeros(po.numero);
    if (citados.has(numeroLimpo) || [...citados].some((c) => c.endsWith(numeroLimpo))) {
      score += 60;
      motivos.push(`A nota cita o pedido ${po.numero}`);
    }

    // 2. Produtos em comum, sobre o que a nota tem de resolvido no catálogo.
    const produtosPedido = new Set(po.items.map((i) => i.productId));
    if (produtosNota.size > 0) {
      const comuns = [...produtosNota].filter((p) => produtosPedido.has(p)).length;
      const fracao = comuns / produtosNota.size;
      score += Math.round(fracao * 30);
      if (comuns > 0) {
        motivos.push(
          `${comuns} de ${produtosNota.size} produtos da nota estão neste pedido`,
        );
      }
    }

    // 3. Valor. Fornecedor fatura parcial o tempo todo, então valor menor não
    //    desqualifica — só deixa de somar.
    const valorPedido = Number(po.valorTotal);
    if (valorPedido > 0 && valorNota > 0) {
      const desvio = Math.abs(valorNota - valorPedido) / valorPedido;
      if (desvio <= 0.05) {
        score += 10;
        motivos.push("Valor da nota bate com o do pedido");
      } else if (desvio <= 0.15) {
        score += 5;
      }
    }

    // 4. Data. Nota emitida antes do pedido é quase sempre outro pedido.
    const dias = (inbound.dataEmissao.getTime() - po.createdAt.getTime()) / 86_400_000;
    if (dias < -1) score -= 20;
    else if (dias <= 30) score += 10;
    else if (dias <= 60) score += 5;
    else score -= 10;

    return {
      purchaseOrderId: po.id,
      numero: po.numero,
      status: po.status,
      valorTotal: valorPedido,
      itens: po.items.length,
      criadoEm: po.createdAt,
      score,
      motivos,
    };
  });

  return sugestoes.sort((a, b) => b.score - a.score);
}

/**
 * Chamado logo depois de importar o XML: se um pedido se destaca com folga,
 * concilia sozinho. Empate ou nada convincente → devolve as sugestões e a tela
 * pergunta.
 */
export async function conciliarComPedidoSugerido(input: {
  tenantId: string;
  inboundId: string;
  userId?: string | null;
}): Promise<{ purchaseOrderId: string | null; numero: string | null; sugestoes: SugestaoPedido[] }> {
  const sugestoes = await sugerirPedidos(input.inboundId);
  const [melhor, segundo] = sugestoes;

  const destaca =
    melhor &&
    melhor.score >= SCORE_AUTOMATICO &&
    (!segundo || melhor.score - segundo.score >= MARGEM_AUTOMATICA);

  if (!destaca) return { purchaseOrderId: null, numero: null, sugestoes };

  await conciliar({
    tenantId: input.tenantId,
    inboundId: input.inboundId,
    purchaseOrderId: melhor.purchaseOrderId,
    userId: input.userId,
    automatico: true,
    score: melhor.score,
  });

  return { purchaseOrderId: melhor.purchaseOrderId, numero: melhor.numero, sugestoes };
}

// ── Conciliação ──────────────────────────────────────────────

type LinhaNova = {
  purchaseOrderItemId: string | null;
  inboundItemId: string | null;
  productId: string | null;
  codigoFornecedor: string | null;
  ean: string | null;
  descricao: string;
  qtdPedida: number;
  qtdFaturada: number;
  custoPedido: number;
  custoFaturado: number;
  bonificacao: boolean;
  status: ReconciliationStatus;
};

/**
 * Uma linha do XML traduzida para a unidade em que a conciliação pensa: base
 * do estoque, com o custo já cheio (ST, IPI, frete, menos desconto).
 *
 * Vive fora dos dois chamadores de propósito — com pedido ou sem ele, "quanto
 * entrou e por quanto" tem de dar o mesmo número; duas cópias disso viram dois
 * custos médios para a mesma caixa.
 */
function medidaDoItem(item: {
  quantidade: unknown;
  fatorConversao: unknown;
  valorTotal: unknown;
  valorDesconto: unknown;
  valorIcmsSt: unknown;
  valorFcpSt: unknown;
  valorIpi: unknown;
  valorFrete: unknown;
  bonificacao: boolean;
}): { qtdBase: number; custoBase: number } {
  const fator = Number(item.fatorConversao) || 1;
  // A linha da conferência conta PEÇA — quem está na doca conta caixa inteira.
  // Fração aqui é conversão errada, e a régua de divergências (CRITICA) segura
  // a nota até alguém arrumar; arredondar é só para a tela não mostrar "1,5
  // garrafa a conferir".
  const qtdBase = unidadesDaLinha(Number(item.quantidade), fator).unidades;
  const custoTotal = custoDoItem({
    valorTotal: Number(item.valorTotal),
    valorDesconto: Number(item.valorDesconto),
    valorIcmsSt: Number(item.valorIcmsSt),
    valorFcpSt: Number(item.valorFcpSt),
    valorIpi: Number(item.valorIpi),
    valorFrete: Number(item.valorFrete),
    bonificacao: item.bonificacao,
  });
  return { qtdBase, custoBase: qtdBase > 0 ? custoTotal / qtdBase : 0 };
}

/**
 * Monta (ou refaz) a conciliação da nota contra um pedido.
 *
 * Casar item da nota com item do pedido é por produto, não por posição: o
 * fornecedor reordena as linhas, quebra uma linha em duas e manda bonificação
 * no meio. Linha do pedido pode ficar sem par (NAO_FATURADO) e linha da nota
 * também (NAO_PEDIDO) — é exatamente isso que o painel de divergências mostra.
 */
export async function conciliar(input: {
  tenantId: string;
  inboundId: string;
  purchaseOrderId: string;
  userId?: string | null;
  automatico?: boolean;
  score?: number | null;
}): Promise<void> {
  const { tenantId, inboundId, purchaseOrderId, userId } = input;

  const inbound = await db.fiscalInbound.findFirst({
    where: { id: inboundId },
    select: {
      id: true,
      status: true,
      numero: true,
      serie: true,
      siteId: true,
      supplierId: true,
      items: {
        select: {
          id: true,
          descricao: true,
          codigoFornecedor: true,
          gtin: true,
          quantidade: true,
          fatorConversao: true,
          productId: true,
          bonificacao: true,
          valorTotal: true,
          valorDesconto: true,
          valorIcmsSt: true,
          valorFcpSt: true,
          valorIpi: true,
          valorFrete: true,
        },
        orderBy: { ordem: "asc" },
      },
    },
  });
  if (!inbound) throw new Error("Nota não encontrada.");
  if (inbound.status === "RECEBIDO") {
    throw new Error("Esta nota já deu entrada no estoque — não dá para reconciliar.");
  }

  const pedido = await db.purchaseOrder.findFirst({
    where: { id: purchaseOrderId },
    select: {
      id: true,
      numero: true,
      siteId: true,
      status: true,
      items: {
        select: {
          id: true,
          productId: true,
          packagingId: true,
          tipo: true,
          qtdPedida: true,
          qtdRecebida: true,
          custoUnitario: true,
        },
      },
    },
  });
  if (!pedido) throw new Error("Pedido não encontrado.");
  if (pedido.status === "CANCELADO") throw new Error("Este pedido está cancelado.");
  if (pedido.siteId !== inbound.siteId) {
    throw new Error("O pedido é de outra loja — a mercadoria entraria no lugar errado.");
  }

  // Fator de cada linha do pedido (caixa → unidade). Uma consulta só.
  const packagingIds = [...new Set(pedido.items.map((i) => i.packagingId).filter(Boolean))];
  const embalagens = packagingIds.length
    ? await db.productPackaging.findMany({
        where: { id: { in: packagingIds as string[] } },
        select: { id: true, fatorConversao: true },
      })
    : [];
  const fatorPacote = new Map(embalagens.map((e) => [e.id, Number(e.fatorConversao)]));

  const nomes = await nomesDeProdutos([
    ...pedido.items.map((i) => i.productId),
    ...inbound.items.map((i) => i.productId),
  ]);

  // Lado do pedido, já em unidade base.
  const doPedido = pedido.items.map((i) => {
    const fator = (i.packagingId ? fatorPacote.get(i.packagingId) : null) ?? 1;
    return {
      id: i.id,
      productId: i.productId,
      compra: i.tipo === "COMPRA",
      qtdBase: unidadesDaLinha(Number(i.qtdPedida), fator).unidades,
      custoBase: fator > 0 ? Number(i.custoUnitario) / fator : 0,
      usado: false,
    };
  });

  const linhas: LinhaNova[] = [];

  for (const item of inbound.items) {
    const { qtdBase, custoBase } = medidaDoItem(item);

    // Par do pedido: mesmo produto, ainda livre. Bonificação da nota procura
    // primeiro uma linha de bonificação do pedido — senão uma caixa de brinde
    // consumiria a linha comprada e o preço "cairia" para zero.
    const candidatos = item.productId
      ? doPedido.filter((p) => !p.usado && p.productId === item.productId)
      : [];
    const par =
      candidatos.find((p) => p.compra !== item.bonificacao) ?? candidatos[0] ?? null;
    if (par) par.usado = true;

    const qtdPedida = par?.qtdBase ?? 0;
    const custoPedido = par?.custoBase ?? 0;
    const status: ReconciliationStatus = par
      ? vereditoDaLinha({ qtdPedida, qtdFaturada: qtdBase, custoPedido, custoFaturado: custoBase })
      : "NAO_PEDIDO";

    linhas.push({
      purchaseOrderItemId: par?.id ?? null,
      inboundItemId: item.id,
      productId: item.productId,
      codigoFornecedor: item.codigoFornecedor,
      ean: item.gtin,
      descricao: (item.productId && nomes.get(item.productId)) || item.descricao,
      qtdPedida,
      qtdFaturada: qtdBase,
      custoPedido,
      custoFaturado: custoBase,
      bonificacao: item.bonificacao,
      status,
    });
  }

  // Sobrou linha do pedido sem par: o fornecedor não faturou.
  for (const p of doPedido) {
    if (p.usado) continue;
    // Já recebido em conferência anterior não é falta desta nota.
    const pendente = p.qtdBase - restanteRecebido(pedido.items, p.id, fatorPacote);
    linhas.push({
      purchaseOrderItemId: p.id,
      inboundItemId: null,
      productId: p.productId,
      codigoFornecedor: null,
      ean: null,
      descricao: nomes.get(p.productId) ?? "Produto do pedido",
      qtdPedida: p.qtdBase,
      qtdFaturada: 0,
      custoPedido: p.custoBase,
      custoFaturado: 0,
      bonificacao: !p.compra,
      status: pendente > TOL_QTD ? "NAO_FATURADO" : "OK",
    });
  }

  await db.purchaseReconciliationItem.deleteMany({ where: { inboundId } });
  await db.purchaseReconciliationItem.createMany({
    data: linhas.map((l) => ({ tenantId, inboundId, purchaseOrderId, ...l })),
  });

  await db.fiscalInbound.update({
    where: { id: inboundId },
    data: {
      purchaseOrderId,
      vinculoAutomatico: input.automatico ?? false,
      scoreVinculo: input.score ?? null,
      conciliadoEm: new Date(),
    },
  });

  // Pedido entra em conferência. RECEBIDO_PARCIAL fica como está: já houve
  // entrada, e voltar para CONFERENCIA esconderia isso das listas.
  if (["ENVIADO", "AGUARDANDO", "EM_TRANSITO"].includes(pedido.status)) {
    await db.purchaseOrder.update({
      where: { id: purchaseOrderId },
      data: { status: "CONFERENCIA" },
    });
  }

  const divergentes = linhas.filter((l) => l.status !== "OK").length;
  await registrarEvento({
    tenantId,
    purchaseOrderId,
    inboundId,
    tipo: "XML_RECEBIDO",
    descricao: `Nota ${inbound.numero}/${inbound.serie} vinculada ${
      input.automatico ? "automaticamente" : "manualmente"
    } ao pedido ${pedido.numero}.`,
    createdBy: userId,
  });
  await registrarEvento({
    tenantId,
    purchaseOrderId,
    inboundId,
    tipo: "CONCILIACAO_CONCLUIDA",
    descricao:
      divergentes === 0
        ? `Conciliação concluída: ${linhas.length} itens sem divergência.`
        : `Conciliação concluída: ${divergentes} de ${linhas.length} itens com divergência.`,
    meta: { itens: linhas.length, divergentes },
    createdBy: userId,
  });
}

/** Quanto desta linha do pedido já entrou em conferências anteriores (base). */
function restanteRecebido(
  items: { id: string; packagingId: string | null; qtdRecebida: unknown }[],
  itemId: string,
  fatores: Map<string, number>,
): number {
  const it = items.find((i) => i.id === itemId);
  if (!it) return 0;
  const fator = (it.packagingId ? fatores.get(it.packagingId) : null) ?? 1;
  return Number(it.qtdRecebida) * fator;
}

async function nomesDeProdutos(ids: (string | null)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  if (unicos.length === 0) return new Map();
  const produtos = await db.product.findMany({
    where: { id: { in: unicos } },
    select: { id: true, nome: true },
  });
  return new Map(produtos.map((p) => [p.id, p.nome]));
}

/**
 * Desfaz o vínculo — a nota volta ao começo, sem pedido e sem conferência.
 *
 * Serve também para desfazer o recebimento sem pedido: lá não há vínculo a
 * romper, mas há a mesma conciliação montada, e o operador que escolheu a
 * porta errada precisa de um caminho de volta.
 */
export async function desvincularPedido(input: {
  tenantId: string;
  inboundId: string;
  userId?: string | null;
}): Promise<void> {
  const inbound = await db.fiscalInbound.findFirst({
    where: { id: input.inboundId },
    select: { id: true, status: true, purchaseOrderId: true, numero: true, serie: true },
  });
  if (!inbound) throw new Error("Nota não encontrada.");
  if (inbound.status === "RECEBIDO") {
    throw new Error("Esta nota já deu entrada no estoque — o vínculo não pode ser desfeito.");
  }

  await registrarEvento({
    tenantId: input.tenantId,
    purchaseOrderId: inbound.purchaseOrderId,
    inboundId: inbound.id,
    tipo: "VINCULO_ALTERADO",
    descricao: inbound.purchaseOrderId
      ? `Nota ${inbound.numero}/${inbound.serie} desvinculada do pedido.`
      : `Conferência sem pedido da nota ${inbound.numero}/${inbound.serie} cancelada.`,
    createdBy: input.userId,
  });

  await db.purchaseReconciliationItem.deleteMany({ where: { inboundId: input.inboundId } });
  await db.fiscalInbound.update({
    where: { id: input.inboundId },
    data: {
      purchaseOrderId: null,
      vinculoAutomatico: false,
      scoreVinculo: null,
      conciliadoEm: null,
    },
  });
}

// ── Recebimento sem pedido ───────────────────────────────────

/**
 * Monta a conferência de uma nota que não tem — e não vai ter — pedido.
 *
 * É a terceira porta do XML, e a mais usada no mercadinho: o representante
 * para na frente da loja, deixa a mercadoria e a nota. Não houve planejamento
 * de compra, então não há o que conciliar; o que existe é mercadoria na porta
 * e uma nota dizendo o que deveria estar dentro da caixa.
 *
 * A camada 1 (pedido) simplesmente não existe aqui: `qtdPedida` e
 * `custoPedido` ficam em zero e a tela esconde a coluna. Preenchê-los com a
 * própria nota faria a conferência comparar a nota consigo mesma e mostrar
 * "pedi 48" de algo que ninguém pediu. Toda linha nasce OK — a única
 * divergência possível é a da camada 3: contei diferente do que a nota diz.
 */
export async function conferirSemPedido(input: {
  tenantId: string;
  inboundId: string;
  userId?: string | null;
}): Promise<void> {
  const { tenantId, inboundId, userId } = input;

  const inbound = await db.fiscalInbound.findFirst({
    where: { id: inboundId },
    select: {
      id: true,
      status: true,
      numero: true,
      serie: true,
      purchaseOrderId: true,
      items: {
        select: {
          id: true,
          descricao: true,
          codigoFornecedor: true,
          gtin: true,
          quantidade: true,
          fatorConversao: true,
          productId: true,
          bonificacao: true,
          valorTotal: true,
          valorDesconto: true,
          valorIcmsSt: true,
          valorFcpSt: true,
          valorIpi: true,
          valorFrete: true,
        },
        orderBy: { ordem: "asc" },
      },
    },
  });
  if (!inbound) throw new Error("Nota não encontrada.");
  if (inbound.status === "RECEBIDO") throw new Error("Esta nota já deu entrada no estoque.");
  if (inbound.status === "DESCARTADO") throw new Error("Esta nota foi descartada.");
  if (inbound.purchaseOrderId) {
    throw new Error("Esta nota está vinculada a um pedido — confira pelo pedido.");
  }
  if (inbound.items.length === 0) throw new Error("A nota não tem itens para conferir.");

  const nomes = await nomesDeProdutos(inbound.items.map((i) => i.productId));

  // Remontar a conciliação não pode apagar a contagem da porta. Aqui isto é
  // rotina, não exceção: relacionar um item ao catálogo no meio da conferência
  // refaz as linhas, e quem já contou trinta caixas não vai contar de novo.
  const anteriores = await db.purchaseReconciliationItem.findMany({
    where: { inboundId },
    select: {
      inboundItemId: true,
      qtdRecebida: true,
      lote: true,
      validade: true,
      resolucao: true,
      motivoDivergencia: true,
    },
  });
  const conferido = new Map(
    anteriores.filter((a) => a.inboundItemId).map((a) => [a.inboundItemId as string, a]),
  );

  const linhas: LinhaNova[] = inbound.items.map((item) => {
    const { qtdBase, custoBase } = medidaDoItem(item);
    return {
      purchaseOrderItemId: null,
      inboundItemId: item.id,
      productId: item.productId,
      codigoFornecedor: item.codigoFornecedor,
      ean: item.gtin,
      descricao: (item.productId && nomes.get(item.productId)) || item.descricao,
      qtdPedida: 0,
      qtdFaturada: qtdBase,
      custoPedido: 0,
      custoFaturado: custoBase,
      bonificacao: item.bonificacao,
      status: "OK",
    };
  });

  await db.purchaseReconciliationItem.deleteMany({ where: { inboundId } });
  await db.purchaseReconciliationItem.createMany({
    data: linhas.map((l) => {
      const antes = l.inboundItemId ? conferido.get(l.inboundItemId) : null;
      return {
        tenantId,
        inboundId,
        purchaseOrderId: null,
        ...l,
        qtdRecebida: antes?.qtdRecebida ?? null,
        lote: antes?.lote ?? null,
        validade: antes?.validade ?? null,
        resolucao: antes?.resolucao ?? null,
        motivoDivergencia: antes?.motivoDivergencia ?? null,
      };
    }),
  });

  await db.fiscalInbound.update({
    where: { id: inboundId },
    data: {
      purchaseOrderId: null,
      vinculoAutomatico: false,
      scoreVinculo: null,
      conciliadoEm: new Date(),
    },
  });

  await registrarEvento({
    tenantId,
    purchaseOrderId: null,
    inboundId,
    tipo: "CONCILIACAO_CONCLUIDA",
    descricao: `Nota ${inbound.numero}/${inbound.serie} em conferência sem pedido — a nota é a referência dos ${linhas.length} itens.`,
    meta: { itens: linhas.length, semPedido: true },
    createdBy: userId,
  });
}

/**
 * Remonta as linhas da conferência pela porta que a nota escolheu. Com pedido
 * é conciliação; sem ele, é a nota contra si mesma. Vive aqui — e não na tela —
 * porque quem relaciona um item ao catálogo (recebimento OU fiscal) precisa
 * refazer as linhas do mesmo jeito, e duas cópias divergem.
 */
export async function remontarConferencia(
  tenantId: string,
  inboundId: string,
  userId: string,
): Promise<void> {
  const nota = await db.fiscalInbound.findFirst({
    where: { id: inboundId },
    select: {
      purchaseOrderId: true,
      conciliadoEm: true,
      vinculoAutomatico: true,
      scoreVinculo: true,
    },
  });
  if (!nota) throw new Error("Nota não encontrada.");

  if (nota.purchaseOrderId) {
    await conciliar({
      tenantId,
      inboundId,
      purchaseOrderId: nota.purchaseOrderId,
      userId,
      automatico: nota.vinculoAutomatico,
      score: nota.scoreVinculo,
    });
    return;
  }
  if (!nota.conciliadoEm) {
    throw new Error("Escolha primeiro como receber esta nota.");
  }
  await conferirSemPedido({ tenantId, inboundId, userId });
}

/** A nota já conciliada não tem pedido por trás? Então é conferência avulsa. */
export async function ehRecebimentoSemPedido(inboundId: string): Promise<boolean> {
  const nota = await db.fiscalInbound.findFirst({
    where: { id: inboundId },
    select: { purchaseOrderId: true, conciliadoEm: true },
  });
  return Boolean(nota && !nota.purchaseOrderId && nota.conciliadoEm);
}

// ── Pedido criado a partir da nota ───────────────────────────

/**
 * Cria o pedido que espelha esta nota e já o concilia.
 *
 * Existe porque metade das compras do mercadinho não nasce de pedido nenhum:
 * o representante passa, deixa a mercadoria e a nota. Sem isto, essa compra
 * ficaria fora do histórico do fornecedor e do controle de recebimento — e o
 * operador teria de digitar à mão um pedido que o XML já descreve inteiro.
 *
 * O pedido nasce em CONFERENCIA, não em RASCUNHO: a mercadoria já está na
 * porta, não há o que enviar ao fornecedor.
 */
export async function criarPedidoDaNota(input: {
  tenantId: string;
  inboundId: string;
  userId?: string | null;
}): Promise<string> {
  const { tenantId, inboundId, userId } = input;

  const inbound = await db.fiscalInbound.findFirst({
    where: { id: inboundId },
    select: {
      id: true,
      siteId: true,
      status: true,
      numero: true,
      serie: true,
      supplierId: true,
      purchaseOrderId: true,
      dataEmissao: true,
      items: {
        select: {
          descricao: true,
          productId: true,
          packagingId: true,
          fatorConversao: true,
          quantidade: true,
          bonificacao: true,
          valorTotal: true,
          valorDesconto: true,
          valorIcmsSt: true,
          valorFcpSt: true,
          valorIpi: true,
          valorFrete: true,
        },
      },
    },
  });
  if (!inbound) throw new Error("Nota não encontrada.");
  if (inbound.purchaseOrderId) throw new Error("Esta nota já está vinculada a um pedido.");
  if (inbound.status === "RECEBIDO") throw new Error("Esta nota já deu entrada no estoque.");
  if (inbound.status === "DESCARTADO") throw new Error("Esta nota foi descartada.");
  if (!inbound.supplierId) {
    throw new Error("A nota não tem fornecedor no cadastro — não dá para abrir um pedido.");
  }

  const semProduto = inbound.items.filter((i) => !i.productId);
  if (semProduto.length > 0) {
    throw new Error(
      `Relacione os itens ao catálogo antes de gerar o pedido. Faltam ${semProduto.length}: ${semProduto
        .slice(0, 3)
        .map((i) => i.descricao)
        .join(", ")}${semProduto.length > 3 ? "…" : ""}`,
    );
  }

  // Só mantém a embalagem quando o fator do de-para é o mesmo do cadastro.
  // Se divergirem, o pedido nasceria em "caixas" de tamanho diferente do que a
  // nota faturou e a conciliação seguinte acusaria divergência que não existe.
  const fatores = await fatoresDe(inbound.items.map((i) => i.packagingId));

  const items = inbound.items.map((i) => {
    const fatorNota = Number(i.fatorConversao) || 1;
    const fatorCadastro = i.packagingId ? fatores.get(i.packagingId) : null;
    const manterEmbalagem = i.packagingId != null && fatorCadastro === fatorNota;

    const qtdPedida = manterEmbalagem
      ? Number(i.quantidade)
      : Number(i.quantidade) * fatorNota;
    const custoTotal = custoDoItem({
      valorTotal: Number(i.valorTotal),
      valorDesconto: Number(i.valorDesconto),
      valorIcmsSt: Number(i.valorIcmsSt),
      valorFcpSt: Number(i.valorFcpSt),
      valorIpi: Number(i.valorIpi),
      valorFrete: Number(i.valorFrete),
      bonificacao: i.bonificacao,
    });

    return {
      productId: i.productId as string,
      packagingId: manterEmbalagem ? i.packagingId : null,
      tipo: i.bonificacao ? ("BONIFICACAO" as const) : ("COMPRA" as const),
      motivoBonificacao: i.bonificacao ? ("COMERCIAL" as const) : null,
      qtdPedida,
      custoUnitario: qtdPedida > 0 ? custoTotal / qtdPedida : 0,
    };
  });

  const purchaseOrderId = await criarPedidoCompra(
    tenantId,
    {
      siteId: inbound.siteId,
      supplierId: inbound.supplierId,
      previsaoEntrega: inbound.dataEmissao,
      observacao: `Pedido gerado a partir da nota ${inbound.numero}/${inbound.serie}.`,
      origem: "XML",
      items,
    },
    { createdBy: userId ?? undefined },
  );

  await db.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { status: "CONFERENCIA", confirmadoEm: new Date() },
  });

  // Score 100: não houve palpite nenhum — o pedido É a nota.
  await conciliar({ tenantId, inboundId, purchaseOrderId, userId, automatico: true, score: 100 });

  return purchaseOrderId;
}

// ── Conferência física ───────────────────────────────────────

/**
 * O que o operador contou na porta. Quantidade em unidade base — a tela
 * converte quando o item é bipado por embalagem.
 *
 * Campo ausente (`undefined`) é campo NÃO MEXIDO; `null` é campo apagado de
 * propósito. A distinção não é preciosismo: a tela salva um campo por vez —
 * bipar manda só a quantidade, sair do campo de lote manda só o lote. Tratar
 * ausente como null fazia o bipe apagar o lote e a validade que o operador
 * acabara de digitar, e o lote zerar a contagem inteira. Silenciosamente, nos
 * dois casos.
 */
export async function conferirItem(input: {
  tenantId: string;
  reconciliationItemId: string;
  qtdRecebida?: number | null;
  lote?: string | null;
  validade?: string | null;
}): Promise<void> {
  const linha = await db.purchaseReconciliationItem.findFirst({
    where: { id: input.reconciliationItemId },
    select: { id: true, qtdFaturada: true, status: true, inbound: { select: { status: true } } },
  });
  if (!linha) throw new Error("Item não encontrado.");
  if (linha.inbound.status === "RECEBIDO") {
    throw new Error("Esta nota já deu entrada — a conferência está encerrada.");
  }

  const mexeuNaQtd = input.qtdRecebida !== undefined;
  const qtd = input.qtdRecebida == null ? null : Math.max(0, input.qtdRecebida);
  const ajustou = qtd != null && Math.abs(qtd - Number(linha.qtdFaturada)) > TOL_QTD;

  await db.purchaseReconciliationItem.update({
    where: { id: linha.id },
    data: {
      ...(mexeuNaQtd ? { qtdRecebida: qtd } : {}),
      ...(input.lote !== undefined ? { lote: input.lote?.trim() || null } : {}),
      ...(input.validade !== undefined
        ? { validade: input.validade ? new Date(`${input.validade}T00:00:00`) : null }
        : {}),
      // Divergir da nota na contagem é uma decisão do operador, e ela precisa
      // sobreviver ao recarregamento da tela.
      resolucao: mexeuNaQtd && ajustou ? "AJUSTADO" : undefined,
    },
  });
}

/** "Conferi tudo como está na nota" — o caminho de 90% dos recebimentos. */
export async function conferirTudoConformeNota(input: {
  tenantId: string;
  inboundId: string;
}): Promise<number> {
  const linhas = await db.purchaseReconciliationItem.findMany({
    where: { inboundId: input.inboundId },
    select: { id: true, qtdFaturada: true },
  });
  for (const l of linhas) {
    await db.purchaseReconciliationItem.update({
      where: { id: l.id },
      data: { qtdRecebida: l.qtdFaturada },
    });
  }
  return linhas.length;
}

/** Divergência vista e decidida. Fica no histórico com quem decidiu. */
export async function resolverDivergencia(input: {
  tenantId: string;
  reconciliationItemId: string;
  resolucao: ReconciliationResolucao;
  motivo?: string | null;
  userId?: string | null;
}): Promise<void> {
  const linha = await db.purchaseReconciliationItem.findFirst({
    where: { id: input.reconciliationItemId },
    select: { id: true, descricao: true, purchaseOrderId: true, inboundId: true, status: true },
  });
  if (!linha) throw new Error("Item não encontrado.");

  await db.purchaseReconciliationItem.update({
    where: { id: linha.id },
    data: { resolucao: input.resolucao, motivoDivergencia: input.motivo?.trim() || null },
  });

  await registrarEvento({
    tenantId: input.tenantId,
    purchaseOrderId: linha.purchaseOrderId,
    inboundId: linha.inboundId,
    tipo: "DIVERGENCIA_RESOLVIDA",
    descricao: `${linha.descricao}: ${LABEL_RESOLUCAO[input.resolucao]}${
      input.motivo?.trim() ? ` — ${input.motivo.trim()}` : ""
    }`,
    meta: { status: linha.status, resolucao: input.resolucao },
    createdBy: input.userId,
  });
}

/**
 * Devolve ao fornecedor o que veio a mais (ou avariado) e já entrou no estoque.
 *
 * Só depois da entrada, de propósito: antes dela, o excedente se resolve
 * baixando a quantidade recebida na conferência — criar movimento de devolução
 * de mercadoria que nunca entrou deixaria a razão contando duas vezes.
 *
 * O movimento sai pelo mesmo `registrarDevolucao` do resto do sistema: o
 * histórico do produto não pode ter duas versões de "saiu por devolução".
 */
export async function devolverItemDivergente(input: {
  tenantId: string;
  reconciliationItemId: string;
  quantidade: number;
  motivo: string;
  userId?: string | null;
}): Promise<void> {
  const { tenantId, quantidade, motivo, userId } = input;
  if (!(quantidade > 0)) throw new Error("Informe a quantidade devolvida.");
  if (motivo.trim().length < 3) throw new Error("Explique o motivo da devolução.");

  const linha = await db.purchaseReconciliationItem.findFirst({
    where: { id: input.reconciliationItemId },
    select: {
      id: true,
      productId: true,
      descricao: true,
      custoFaturado: true,
      qtdFaturada: true,
      purchaseOrderId: true,
      inboundId: true,
      inbound: { select: { siteId: true, status: true, numero: true, purchaseId: true } },
    },
  });
  if (!linha) throw new Error("Item não encontrado.");
  if (!linha.productId) throw new Error("Relacione o item a um produto antes de devolver.");
  if (linha.inbound.status !== "RECEBIDO") {
    throw new Error(
      "A nota ainda não deu entrada. Antes da entrada, corrija a quantidade na conferência " +
        "em vez de devolver.",
    );
  }

  const unitario = Number(linha.qtdFaturada) > 0
    ? Number(linha.custoFaturado) / Number(linha.qtdFaturada)
    : 0;

  await registrarDevolucao(
    tenantId,
    linha.inbound.siteId,
    linha.productId,
    "FORNECEDOR",
    { fechado: quantidade },
    `NF ${linha.inbound.numero} — ${motivo.trim()}`,
    {
      custoUnitario: unitario,
      purchaseId: linha.inbound.purchaseId ?? undefined,
      createdBy: userId ?? undefined,
    },
  );

  await db.purchaseReconciliationItem.update({
    where: { id: linha.id },
    data: { resolucao: "AJUSTADO", motivoDivergencia: `Devolvido ao fornecedor: ${motivo.trim()}` },
  });

  await registrarEvento({
    tenantId,
    purchaseOrderId: linha.purchaseOrderId,
    inboundId: linha.inboundId,
    tipo: "DIVERGENCIA_RESOLVIDA",
    descricao: `${linha.descricao}: ${quantidade} devolvido(s) ao fornecedor — ${motivo.trim()}`,
    meta: { quantidade, motivo: motivo.trim() },
    createdBy: userId,
  });
}

/**
 * Texto pronto da reclamação, com os números da nota. Existe porque o desfecho
 * real de uma divergência acontece FORA do sistema — no WhatsApp do
 * representante — e reescrever isso à mão, item a item, é o que faz o operador
 * desistir e "deixar passar".
 */
export async function resumoDivergenciasParaFornecedor(input: {
  tenantId: string;
  inboundId: string;
  empresa: string;
}): Promise<{ texto: string; fornecedor: string; telefone: string | null; email: string | null }> {
  const inbound = await db.fiscalInbound.findFirst({
    where: { id: input.inboundId },
    select: {
      numero: true,
      serie: true,
      dataEmissao: true,
      emitRazaoSocial: true,
      purchaseOrder: { select: { numero: true } },
      supplier: { select: { razaoSocial: true, nomeFantasia: true, telefone: true, email: true } },
    },
  });
  if (!inbound) throw new Error("Nota não encontrada.");

  const linhas = await db.purchaseReconciliationItem.findMany({
    where: { inboundId: input.inboundId, status: { not: "OK" } },
    orderBy: { descricao: "asc" },
    select: {
      descricao: true,
      status: true,
      qtdPedida: true,
      qtdFaturada: true,
      qtdRecebida: true,
      custoPedido: true,
      custoFaturado: true,
      motivoDivergencia: true,
    },
  });
  if (linhas.length === 0) throw new Error("Esta nota não tem divergência para relatar.");

  const n = (v: unknown) => Number(v ?? 0);
  const qtd = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const itens = linhas.map((l) => {
    const recebido = l.qtdRecebida == null ? n(l.qtdFaturada) : n(l.qtdRecebida);
    switch (l.status) {
      case "FALTANDO":
      case "NAO_FATURADO":
        return `• ${l.descricao}: pedimos ${qtd(n(l.qtdPedida))}, veio ${qtd(n(l.qtdFaturada))}`;
      case "EXCEDENTE":
      case "NAO_PEDIDO":
        return `• ${l.descricao}: veio ${qtd(n(l.qtdFaturada))} e o pedido era de ${qtd(n(l.qtdPedida))}`;
      case "PRECO_ALTERADO":
        return `• ${l.descricao}: preço combinado ${moeda(n(l.custoPedido))}, faturado ${moeda(n(l.custoFaturado))}`;
      default:
        return `• ${l.descricao}: conferido ${qtd(recebido)} de ${qtd(n(l.qtdFaturada))}`;
    }
  });

  const comMotivo = linhas.filter((l) => l.motivoDivergencia);
  const texto = [
    `Olá! Sobre a NF ${inbound.numero}/${inbound.serie} de ${new Date(inbound.dataEmissao).toLocaleDateString("pt-BR")}` +
      (inbound.purchaseOrder ? ` (nosso pedido ${inbound.purchaseOrder.numero})` : "") +
      ":",
    "",
    ...itens,
    ...(comMotivo.length > 0
      ? ["", "Observações da conferência:", ...comMotivo.map((l) => `• ${l.descricao}: ${l.motivoDivergencia}`)]
      : []),
    "",
    "Podem confirmar como resolvemos? Obrigado.",
    input.empresa,
  ].join("\n");

  const s = inbound.supplier;
  return {
    texto,
    fornecedor: s?.nomeFantasia ?? s?.razaoSocial ?? inbound.emitRazaoSocial,
    telefone: s?.telefone ?? null,
    email: s?.email ?? null,
  };
}

const LABEL_RESOLUCAO: Record<ReconciliationResolucao, string> = {
  ACEITO: "aceito como está na nota",
  IGNORADO: "divergência ignorada",
  AJUSTADO: "quantidade ajustada na conferência",
};

/**
 * Aceita o custo da nota como o novo custo negociado: reescreve o custo do
 * item no pedido (em unidade de compra) e o total do pedido.
 *
 * O estoque entra pelo custo da NOTA de qualquer jeito — é o que foi pago.
 * Aceitar aqui é sobre o pedido e sobre a próxima compra, não sobre esta.
 */
export async function aceitarCustoDaNota(input: {
  tenantId: string;
  reconciliationItemId: string;
  userId?: string | null;
}): Promise<void> {
  const linha = await db.purchaseReconciliationItem.findFirst({
    where: { id: input.reconciliationItemId },
    select: {
      id: true,
      descricao: true,
      custoPedido: true,
      custoFaturado: true,
      purchaseOrderId: true,
      purchaseOrderItemId: true,
      inboundId: true,
    },
  });
  if (!linha) throw new Error("Item não encontrado.");
  if (!linha.purchaseOrderId || !linha.purchaseOrderItemId) {
    throw new Error("Este item não está no pedido — não há custo negociado para atualizar.");
  }
  const purchaseOrderId = linha.purchaseOrderId;

  const item = await db.purchaseOrderItem.findFirst({
    where: { id: linha.purchaseOrderItemId },
    select: { id: true, packagingId: true, qtdPedida: true },
  });
  if (!item) throw new Error("Item do pedido não encontrado.");

  const fator = item.packagingId
    ? Number(
        (
          await db.productPackaging.findFirst({
            where: { id: item.packagingId },
            select: { fatorConversao: true },
          })
        )?.fatorConversao ?? 1,
      )
    : 1;

  const novoCusto = Number(linha.custoFaturado) * fator;
  await db.purchaseOrderItem.update({
    where: { id: item.id },
    data: { custoUnitario: novoCusto },
  });

  // valorTotal do pedido é soma cacheada — recalcula com o custo novo.
  const itens = await db.purchaseOrderItem.findMany({
    where: { purchaseOrderId },
    select: { qtdPedida: true, custoUnitario: true },
  });
  const total = itens.reduce((s, i) => s + Number(i.qtdPedida) * Number(i.custoUnitario), 0);
  await db.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { valorTotal: total },
  });

  await db.purchaseReconciliationItem.update({
    where: { id: linha.id },
    data: { resolucao: "ACEITO", custoPedido: linha.custoFaturado },
  });

  await registrarEvento({
    tenantId: input.tenantId,
    purchaseOrderId: linha.purchaseOrderId,
    inboundId: linha.inboundId,
    tipo: "CUSTO_ACEITO",
    descricao: `${linha.descricao}: custo do pedido atualizado para o da nota.`,
    meta: {
      de: Number(linha.custoPedido),
      para: Number(linha.custoFaturado),
      unidade: "base",
    },
    createdBy: input.userId,
  });
}

// ── Entrada no estoque ───────────────────────────────────────

/**
 * Camada 3. Fecha o recebimento: move o estoque, acumula o recebido no pedido,
 * marca a nota e escreve a timeline. É a ÚNICA função daqui que mexe em saldo.
 *
 * Linha sem conferência (`qtdRecebida` nulo) entra pelo que a nota diz — a tela
 * mostra quantas são antes de confirmar. Item da nota sem produto relacionado
 * trava tudo: entrar com mercadoria sem cadastro é perder o rastro dela.
 */
export async function confirmarEntradaConciliada(input: {
  tenantId: string;
  inboundId: string;
  userId?: string | null;
}): Promise<string> {
  const { tenantId, inboundId, userId } = input;

  const inbound = await db.fiscalInbound.findFirst({
    where: { id: inboundId },
    select: {
      id: true,
      siteId: true,
      status: true,
      chave: true,
      numero: true,
      serie: true,
      supplierId: true,
      purchaseOrderId: true,
      emitRazaoSocial: true,
    },
  });
  if (!inbound) throw new Error("Nota não encontrada.");
  if (inbound.status === "RECEBIDO") throw new Error("Esta nota já gerou entrada de estoque.");
  if (inbound.status === "DESCARTADO") throw new Error("Esta nota foi descartada.");
  // Sem pedido é caso legítimo: o recebimento sem pedido monta a conciliação
  // direto da nota. O que trava a entrada não é a falta de pedido, é a falta
  // de conferência — e disso quem reclama é o `linhas.length === 0` abaixo.
  const pedido = inbound.purchaseOrderId
    ? await db.purchaseOrder.findFirst({
        where: { id: inbound.purchaseOrderId },
        select: { id: true, numero: true, status: true, financeiroGerado: true },
      })
    : null;
  if (inbound.purchaseOrderId && !pedido) throw new Error("Pedido não encontrado.");

  const linhas = await db.purchaseReconciliationItem.findMany({
    where: { inboundId },
    select: {
      id: true,
      productId: true,
      descricao: true,
      qtdFaturada: true,
      qtdRecebida: true,
      custoFaturado: true,
      bonificacao: true,
      lote: true,
      validade: true,
      purchaseOrderItemId: true,
      inboundItemId: true,
    },
  });
  if (linhas.length === 0) {
    throw new Error(
      "Escolha primeiro como receber esta nota: vincular a um pedido, gerar o pedido ou conferir sem pedido.",
    );
  }

  const entrando = linhas
    .map((l) => ({
      ...l,
      qtd: l.qtdRecebida == null ? Number(l.qtdFaturada) : Number(l.qtdRecebida),
    }))
    .filter((l) => l.qtd > TOL_QTD);

  if (entrando.length === 0) throw new Error("Nenhum item foi recebido — nada a dar entrada.");

  const semProduto = entrando.filter((l) => !l.productId);
  if (semProduto.length > 0) {
    throw new Error(
      `Relacione ao produto antes de receber. Faltam ${semProduto.length}: ${semProduto
        .slice(0, 3)
        .map((l) => l.descricao)
        .join(", ")}${semProduto.length > 3 ? "…" : ""}`,
    );
  }

  const paraEntrada = (l: (typeof entrando)[number]): EntradaItem => ({
    productId: l.productId as string,
    // Quantidade JÁ em unidade base — packagingId null de propósito, senão
    // `registrarEntrada` converteria de novo e dobraria o fardo.
    quantidade: l.qtd,
    custoTotal: l.bonificacao ? 0 : l.qtd * Number(l.custoFaturado),
    packagingId: null,
    lote: l.lote,
    validade: l.validade ? l.validade.toISOString().slice(0, 10) : null,
  });

  const comprados = entrando.filter((l) => !l.bonificacao);
  const bonificados = entrando.filter((l) => l.bonificacao);

  // Sem pedido, a origem da mercadoria é a própria nota — e é ela que a
  // entrada carrega (chave, número, fornecedor). Marcar `aguardandoDocumento`
  // aqui seria mentira: o documento chegou primeiro, foi ele que abriu a
  // conferência.
  const referencia = pedido
    ? `Recebimento do pedido ${pedido.numero} — nota ${inbound.numero}`
    : `Recebimento sem pedido — nota ${inbound.numero}/${inbound.serie}`;

  let purchaseId = "";
  if (comprados.length > 0) {
    purchaseId = await registrarEntrada(tenantId, inbound.siteId, comprados.map(paraEntrada), {
      tipo: "FORNECEDOR",
      motivo: pedido ? null : "COMPRA_SEM_PEDIDO",
      supplierId: inbound.supplierId,
      purchaseOrderId: pedido?.id ?? null,
      numeroNota: `${inbound.numero}/${inbound.serie}`,
      chaveNfe: inbound.chave,
      observacao: referencia,
      createdBy: userId ?? undefined,
    });
  }
  if (bonificados.length > 0) {
    const idBonus = await registrarEntrada(
      tenantId,
      inbound.siteId,
      bonificados.map(paraEntrada),
      {
        tipo: "FORNECEDOR",
        motivo: "BONIFICACAO",
        supplierId: inbound.supplierId,
        purchaseOrderId: pedido?.id ?? null,
        numeroNota: `${inbound.numero}/${inbound.serie}`,
        chaveNfe: inbound.chave,
        observacao: pedido
          ? `Bonificação do pedido ${pedido.numero} — nota ${inbound.numero}`
          : `Bonificação sem pedido — nota ${inbound.numero}/${inbound.serie}`,
        createdBy: userId ?? undefined,
      },
    );
    purchaseId ||= idBonus;
  }

  // Acumula o recebido em cada linha do pedido, de volta em unidade de compra.
  // Sem pedido não há saldo a acumular: a nota inteira entrou de uma vez.
  let completo = true;
  if (pedido) {
    const itensPedido = await db.purchaseOrderItem.findMany({
      where: { purchaseOrderId: pedido.id },
      select: { id: true, packagingId: true, qtdPedida: true, qtdRecebida: true },
    });
    const fatores = await fatoresDe(itensPedido.map((i) => i.packagingId));

    const recebidoPorItem = new Map<string, number>();
    for (const l of entrando) {
      if (!l.purchaseOrderItemId) continue; // item fora do pedido não tem onde somar
      recebidoPorItem.set(
        l.purchaseOrderItemId,
        (recebidoPorItem.get(l.purchaseOrderItemId) ?? 0) + l.qtd,
      );
    }

    for (const it of itensPedido) {
      const fator = (it.packagingId ? fatores.get(it.packagingId) : null) ?? 1;
      const novo =
        Number(it.qtdRecebida) + (recebidoPorItem.get(it.id) ?? 0) / (fator > 0 ? fator : 1);
      if (recebidoPorItem.has(it.id)) {
        await db.purchaseOrderItem.update({ where: { id: it.id }, data: { qtdRecebida: novo } });
      }
      if (novo < Number(it.qtdPedida) - TOL_QTD) completo = false;
    }

    await db.purchaseOrder.update({
      where: { id: pedido.id },
      data: {
        status: completo ? "RECEBIDO" : "RECEBIDO_PARCIAL",
        recebidoEm: completo ? new Date() : null,
      },
    });
  }

  await db.fiscalInbound.update({
    where: { id: inboundId },
    data: { status: "RECEBIDO", purchaseId: purchaseId || null },
  });

  // Estoque e financeiro são o mesmo fato visto de dois lados. As duplicatas da
  // nota viram títulos aqui, no instante em que a mercadoria passa a ser nossa.
  const titulos = await gerarTitulosDaNota({
    tenantId,
    inboundId,
    purchaseId: purchaseId || null,
    userId,
  });
  if (titulos.criados > 0) {
    await registrarEvento({
      tenantId,
      purchaseOrderId: pedido?.id ?? null,
      inboundId,
      tipo: "TITULOS_GERADOS",
      descricao: titulos.estimado
        ? `1 título a pagar de R$ ${titulos.valorTotal.toFixed(2)} — a nota não trouxe duplicata, o vencimento veio do prazo do fornecedor.`
        : `${titulos.criados} título(s) a pagar, somando R$ ${titulos.valorTotal.toFixed(2)}.`,
      meta: { criados: titulos.criados, valorTotal: titulos.valorTotal },
      createdBy: userId,
    });
  }

  // Custo de referência do produto: agora o dinheiro é real, então o que a
  // nota cobrou vira o custo do cadastro. (Custo médio quem move é o serviço
  // de estoque; este é o "quanto custou da última vez" que a tela mostra.)
  await atualizarCustoDeReferencia(
    comprados.map((l) => ({
      productId: l.productId as string,
      custoUnitarioBase: Number(l.custoFaturado),
    })),
  );

  await registrarEvento({
    tenantId,
    purchaseOrderId: pedido?.id ?? null,
    inboundId,
    tipo: "CONFERENCIA_CONCLUIDA",
    descricao: `Conferência física concluída: ${entrando.length} itens recebidos.`,
    createdBy: userId,
  });
  await registrarEvento({
    tenantId,
    purchaseOrderId: pedido?.id ?? null,
    inboundId,
    tipo: "ESTOQUE_ATUALIZADO",
    descricao: !pedido
      ? `Estoque atualizado pela nota ${inbound.numero}/${inbound.serie}, sem pedido.`
      : completo
        ? `Estoque atualizado. Pedido ${pedido.numero} recebido integralmente.`
        : `Estoque atualizado. Pedido ${pedido.numero} segue com itens pendentes.`,
    meta: { purchaseId, itens: entrando.length },
    createdBy: userId,
  });

  return purchaseId;
}

async function fatoresDe(ids: (string | null)[]): Promise<Map<string, number>> {
  const unicos = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  if (unicos.length === 0) return new Map();
  const pacotes = await db.productPackaging.findMany({
    where: { id: { in: unicos } },
    select: { id: true, fatorConversao: true },
  });
  return new Map(pacotes.map((p) => [p.id, Number(p.fatorConversao)]));
}
