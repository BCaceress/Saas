import "server-only";
import { db } from "@/lib/prisma";
import { criarPedidoCompra } from "@/lib/estoque";
import { custoDoItem } from "@/lib/fiscal/custo";
import { unidadesDaLinha } from "@/lib/fiscal/unidades";
import { registrarEvento } from "./eventos";
import { garantirRecebimentoDaNota, fatoresDe } from "./recebimento";
import { criarDevolucaoFornecedor } from "./devolucao";
import { enviarEmail } from "@/lib/email";
import { gerarXlsx } from "@/lib/relatorios/xlsx";
import {
  TOL_QTD,
  absorverAvulsas,
  mesclarContagemAnterior,
  planejarConciliacao,
  type ItemDoPedidoConciliado,
} from "./conciliacao-regras";
import {
  custoDeEntradaDaLinha,
  esperadoDaLinha,
  frasesDeDivergencia,
  lotesDoJson,
  quantidadeQueEntra,
} from "./recebimento-regras";
import type {
  Prisma,
  PurchaseOrderStatus,
  ReconciliationResolucao,
  ReconciliationStatus,
  SupplierReturnMotivo,
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

/** O que a doca já escreveu nas linhas — o que remontar não pode apagar. */
const SELECT_CONTAGEM = {
  id: true,
  inboundItemId: true,
  purchaseOrderItemId: true,
  productId: true,
  bonificacao: true,
  status: true,
  qtdRecebida: true,
  lote: true,
  validade: true,
  lotes: true,
  contadoPor: true,
  contadoEm: true,
  resolucao: true,
  motivoDivergencia: true,
} as const;

/**
 * Troca as linhas que nasceram da nota e do pedido pelas novas, com a contagem
 * já carregada — e deixa em paz as que a doca acrescentou ("veio a mais",
 * "Adicionar item"). Essas não nascem de documento nenhum, então remontar não
 * as recria: apagá-las junto com as outras sumia com mercadoria contada sempre
 * que alguém relacionava um item ao catálogo no meio da conferência.
 */
async function regravarLinhas(input: {
  tenantId: string;
  receiptId: string;
  inboundId: string;
  purchaseOrderId: string | null;
  linhas: LinhaNova[];
  decisaoSoComMesmoVeredito: boolean;
  /**
   * A nota acaba de chegar a um recebimento contado à mão: a contagem das
   * linhas avulsas passa para a linha da nota do mesmo produto (ver
   * `absorverAvulsas`). Só no vínculo — remontar por outro motivo não mexe na
   * linha que a doca abriu.
   */
  absorverAvulsas?: boolean;
}): Promise<void> {
  const { tenantId, receiptId, inboundId, purchaseOrderId } = input;
  const anteriores = await db.purchaseReconciliationItem.findMany({
    where: { receiptId },
    select: SELECT_CONTAGEM,
  });
  const todasAvulsas = anteriores.filter((a) => !a.inboundItemId && !a.purchaseOrderItemId);
  const mescladas = mesclarContagemAnterior(input.linhas, anteriores, {
    decisaoSoComMesmoVeredito: input.decisaoSoComMesmoVeredito,
  });
  const { linhas: novas, absorvidas } = input.absorverAvulsas
    ? absorverAvulsas(mescladas, todasAvulsas)
    : { linhas: mescladas, absorvidas: [] as string[] };
  const avulsas = todasAvulsas.filter((a) => !absorvidas.includes(a.id));
  if (absorvidas.length > 0) {
    await db.purchaseReconciliationItem.deleteMany({ where: { id: { in: absorvidas } } });
  }

  await db.purchaseReconciliationItem.deleteMany({
    where: {
      receiptId,
      OR: [{ inboundItemId: { not: null } }, { purchaseOrderItemId: { not: null } }],
    },
  });
  if (avulsas.length > 0) {
    // A linha avulsa acompanha o documento da vez: com o pedido trocado, ela
    // passa a ser "fora deste pedido".
    await db.purchaseReconciliationItem.updateMany({
      where: { id: { in: avulsas.map((a) => a.id) } },
      data: { inboundId, purchaseOrderId },
    });
  }
  if (novas.length > 0) {
    await db.purchaseReconciliationItem.createMany({
      // JSON nulo não se grava como `null` — sem lote repartido, o campo fica de fora.
      data: novas.map(({ lotes, ...l }) => ({
        tenantId,
        receiptId,
        inboundId,
        purchaseOrderId,
        ...l,
        ...(lotes != null ? { lotes: lotes as Prisma.InputJsonValue } : {}),
      })),
    });
  }
}

/**
 * Monta (ou refaz) a conciliação da nota contra um pedido.
 *
 * Casar item da nota com item do pedido é por produto, não por posição — a
 * regra mora em `planejarConciliacao`, pura e testada. Linha do pedido pode
 * ficar sem par (NAO_FATURADO) e linha da nota também (NAO_PEDIDO) — é
 * exatamente isso que o painel de divergências mostra.
 *
 * O pedido entra pelo SALDO: a segunda nota de um pedido entregue em duas
 * vezes é conferida contra o que ainda faltava, não contra o pedido inteiro.
 */
export async function conciliar(input: {
  tenantId: string;
  inboundId: string;
  purchaseOrderId: string;
  userId?: string | null;
  automatico?: boolean;
  score?: number | null;
  /** A nota chegou a um recebimento contado à mão — ver `regravarLinhas`. */
  absorverAvulsas?: boolean;
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

  // Lado do pedido, já em unidade base — e pelo que ainda falta chegar.
  const doPedido: ItemDoPedidoConciliado[] = pedido.items.map((i) => {
    const fator = (i.packagingId ? fatorPacote.get(i.packagingId) : null) ?? 1;
    const pedida = unidadesDaLinha(Number(i.qtdPedida), fator).unidades;
    const recebida = unidadesDaLinha(Number(i.qtdRecebida), fator).unidades;
    return {
      id: i.id,
      productId: i.productId,
      compra: i.tipo === "COMPRA",
      saldo: Math.max(0, pedida - recebida),
      custoBase: fator > 0 ? Number(i.custoUnitario) / fator : 0,
    };
  });

  const itemDaNota = new Map(inbound.items.map((i) => [i.id, i]));
  const planejadas = planejarConciliacao(
    doPedido,
    inbound.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      bonificacao: item.bonificacao,
      ...medidaDoItem(item),
    })),
  );
  const linhas: LinhaNova[] = planejadas.map((p) => {
    const item = p.inboundItemId ? itemDaNota.get(p.inboundItemId) : null;
    return {
      ...p,
      codigoFornecedor: item?.codigoFornecedor ?? null,
      ean: item?.gtin ?? null,
      descricao:
        (p.productId && nomes.get(p.productId)) || item?.descricao || "Produto do pedido",
    };
  });

  // A conferência é do RECEBIMENTO, não da nota: é ele que existe também
  // quando o XML ainda não chegou, e é por ele que a tela abre.
  const receipt = await garantirRecebimentoDaNota({ tenantId, inboundId, userId });
  await db.goodsReceipt.update({
    where: { id: receipt.id },
    data: { purchaseOrderId, status: "EM_CONFERENCIA" },
  });

  // Remontar a conciliação não pode apagar a contagem da porta: relacionar um
  // item ao catálogo com a conferência aberta refaz as linhas, e quem já
  // contou trinta caixas não conta de novo.
  await regravarLinhas({
    tenantId,
    receiptId: receipt.id,
    inboundId,
    purchaseOrderId,
    linhas,
    decisaoSoComMesmoVeredito: true,
    absorverAvulsas: input.absorverAvulsas,
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

  // O status do pedido NÃO muda aqui. "Em conferência" é situação da doca, e
  // vive no recebimento (GoodsReceipt.status); o pedido segue confirmado —
  // aguardando entrega — enquanto alguém conta caixa na porta.

  const divergentes = linhas.filter((l) => l.status !== "OK").length;
  await registrarEvento({
    tenantId,
    purchaseOrderId,
    inboundId,
    receiptId: receipt.id,
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
    receiptId: receipt.id,
    tipo: "CONCILIACAO_CONCLUIDA",
    descricao:
      divergentes === 0
        ? `Conciliação concluída: ${linhas.length} itens sem divergência.`
        : `Conciliação concluída: ${divergentes} de ${linhas.length} itens com divergência.`,
    meta: { itens: linhas.length, divergentes },
    createdBy: userId,
  });
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

  // As linhas são do recebimento DESTA nota. Apagar por nota levava junto a
  // conferência de um recebimento já cancelado, que é história.
  const receipt = await db.goodsReceipt.findFirst({
    where: { inboundId: input.inboundId },
    select: { id: true },
  });

  await registrarEvento({
    tenantId: input.tenantId,
    purchaseOrderId: inbound.purchaseOrderId,
    inboundId: inbound.id,
    receiptId: receipt?.id ?? null,
    tipo: "VINCULO_ALTERADO",
    descricao: inbound.purchaseOrderId
      ? `Nota ${inbound.numero}/${inbound.serie} desvinculada do pedido.`
      : `Conferência sem pedido da nota ${inbound.numero}/${inbound.serie} cancelada.`,
    createdBy: input.userId,
  });

  await db.purchaseReconciliationItem.deleteMany({
    where: receipt ? { receiptId: receipt.id } : { inboundId: input.inboundId },
  });
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
  /** A nota chegou a um recebimento contado à mão — ver `regravarLinhas`. */
  absorverAvulsas?: boolean;
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

  const recebimento = await garantirRecebimentoDaNota({ tenantId, inboundId, userId });

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

  // Remontar a conciliação não pode apagar a contagem da porta. Aqui isto é
  // rotina, não exceção: relacionar um item ao catálogo no meio da conferência
  // refaz as linhas, e quem já contou trinta caixas não vai contar de novo.
  // Toda linha nasce OK e continua OK: a decisão registrada vale sempre.
  await regravarLinhas({
    tenantId,
    receiptId: recebimento.id,
    inboundId,
    purchaseOrderId: null,
    linhas,
    decisaoSoComMesmoVeredito: false,
    absorverAvulsas: input.absorverAvulsas,
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

  await db.goodsReceipt.update({
    where: { id: recebimento.id },
    data: { purchaseOrderId: null, status: "EM_CONFERENCIA" },
  });

  await registrarEvento({
    tenantId,
    purchaseOrderId: null,
    inboundId,
    receiptId: recebimento.id,
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

// ── Pedido criado a partir da nota ───────────────────────────

/**
 * Cria o pedido que espelha esta nota e já o concilia.
 *
 * Existe porque metade das compras do mercadinho não nasce de pedido nenhum:
 * o representante passa, deixa a mercadoria e a nota. Sem isto, essa compra
 * ficaria fora do histórico do fornecedor e do controle de recebimento — e o
 * operador teria de digitar à mão um pedido que o XML já descreve inteiro.
 *
 * O pedido nasce AGUARDANDO (confirmado), não em RASCUNHO: a mercadoria já
 * está na porta, não há o que enviar ao fornecedor. Quem diz que a conferência
 * começou é o recebimento, não ele.
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
    data: { status: "AGUARDANDO", confirmadoEm: new Date() },
  });

  // Score 100: não houve palpite nenhum — o pedido É a nota.
  await conciliar({ tenantId, inboundId, purchaseOrderId, userId, automatico: true, score: 100 });

  return purchaseOrderId;
}

// ── Divergências ─────────────────────────────────────────────
//
// A contagem em si (quantidade, lote, validade) é gravada por
// `registrarContagem`, em `recebimento.ts` — o dono da linha é o recebimento.

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
    select: {
      id: true,
      descricao: true,
      purchaseOrderId: true,
      inboundId: true,
      receiptId: true,
      status: true,
      receipt: { select: { status: true } },
    },
  });
  if (!linha) throw new Error("Item não encontrado.");
  if (linha.receipt?.status === "FINALIZADO" || linha.receipt?.status === "CANCELADO") {
    throw new Error("Este recebimento está encerrado — a decisão já não muda nada.");
  }

  await db.purchaseReconciliationItem.update({
    where: { id: linha.id },
    data: { resolucao: input.resolucao, motivoDivergencia: input.motivo?.trim() || null },
  });

  await registrarEvento({
    tenantId: input.tenantId,
    purchaseOrderId: linha.purchaseOrderId,
    inboundId: linha.inboundId,
    // Sem o recebimento, a decisão sumia da história da tela que a tomou.
    receiptId: linha.receiptId,
    tipo: "DIVERGENCIA_RESOLVIDA",
    descricao: `${linha.descricao}: ${LABEL_RESOLUCAO[input.resolucao]}${
      input.motivo?.trim() ? ` — ${input.motivo.trim()}` : ""
    }`,
    meta: { status: linha.status, resolucao: input.resolucao },
    createdBy: input.userId,
  });
}

/**
 * Devolve ao fornecedor o que entrou no estoque e não devia ficar — o
 * excedente, a caixa avariada que só apareceu ao abrir, a validade curta.
 *
 * Só depois da entrada, de propósito: antes dela, o excedente se resolve
 * baixando a quantidade recebida na conferência — criar movimento de devolução
 * de mercadoria que nunca entrou deixaria a razão contando duas vezes.
 *
 * Sai como DEVOLUÇÃO DE VERDADE (`SupplierReturn`), a mesma de
 * /estoque/devolucoes: um documento com número, que tira do estoque e abate
 * o que se deve ao fornecedor. Antes este botão só mexia no saldo — a
 * mercadoria voltava no caminhão e o título continuava cobrando por ela.
 *
 * O custo é o com que a linha ENTROU: o custo da nota por unidade, que já é
 * unitário (dividi-lo de novo pela quantidade devolvia a mercadoria por
 * centavos).
 */
export async function devolverItemDivergente(input: {
  tenantId: string;
  reconciliationItemId: string;
  quantidade: number;
  motivo: string;
  /** Por que voltou — a mesma classificação das devoluções. */
  tipoMotivo?: SupplierReturnMotivo;
  userId?: string | null;
}): Promise<{ numero: string; abatido: number; sobra: number }> {
  const { tenantId, quantidade, motivo, userId } = input;
  if (!(quantidade > 0) || !Number.isInteger(quantidade)) {
    throw new Error("Informe a quantidade devolvida, em unidades inteiras.");
  }
  if (motivo.trim().length < 3) throw new Error("Explique o motivo da devolução.");

  const linha = await db.purchaseReconciliationItem.findFirst({
    where: { id: input.reconciliationItemId },
    select: {
      id: true,
      productId: true,
      descricao: true,
      status: true,
      bonificacao: true,
      qtdPedida: true,
      qtdFaturada: true,
      qtdRecebida: true,
      custoPedido: true,
      custoFaturado: true,
      purchaseOrderId: true,
      inboundId: true,
      receiptId: true,
      inbound: { select: { numero: true, serie: true, chave: true } },
      receipt: {
        select: { id: true, numero: true, status: true, siteId: true, supplierId: true, numeroNota: true },
      },
    },
  });
  if (!linha) throw new Error("Item não encontrado.");
  if (!linha.productId) throw new Error("Relacione o item a um produto antes de devolver.");
  if (!linha.receipt || linha.receipt.status !== "FINALIZADO") {
    throw new Error(
      "Este recebimento ainda não deu entrada. Antes da entrada, corrija a quantidade na " +
        "conferência em vez de devolver.",
    );
  }
  if (!linha.receipt.supplierId) {
    throw new Error(
      "Este recebimento não tem fornecedor cadastrado — a devolução precisa dele para abater o que se deve. Corrija o estoque pelo inventário.",
    );
  }

  const entrou = quantidadeQueEntra(linha);
  if (quantidade > entrou + TOL_QTD) {
    throw new Error(
      `Desta linha entraram ${entrou} — não dá para devolver ${quantidade}. Confira a quantidade.`,
    );
  }

  // A entrada que esta linha gerou — é a ela que a devolução se refere.
  const entrada = await db.purchase.findFirst({
    where: {
      receiptId: linha.receipt.id,
      estornadaEm: null,
      items: { some: { productId: linha.productId } },
    },
    select: { id: true },
  });

  const nota = linha.inbound;
  const dev = await criarDevolucaoFornecedor({
    tenantId,
    siteId: linha.receipt.siteId,
    supplierId: linha.receipt.supplierId,
    motivo: input.tipoMotivo ?? "DIVERGENCIA",
    observacao: `${motivo.trim()} — recebimento ${linha.receipt.numero}`,
    itens: [
      {
        productId: linha.productId,
        quantidade,
        custoUnitario: custoDeEntradaDaLinha(linha),
        observacao: linha.descricao,
      },
    ],
    purchaseId: entrada?.id ?? null,
    purchaseOrderId: linha.purchaseOrderId,
    inboundId: linha.inboundId,
    numeroNota: nota ? `${nota.numero}/${nota.serie}` : linha.receipt.numeroNota,
    chaveNfe: nota?.chave ?? null,
    // Na doca a decisão já está tomada — o caminhão está levando a caixa.
    confirmar: true,
    userId,
  });
  const credito = await db.accountPayablePayment.aggregate({
    where: { returnId: dev.id },
    _sum: { valor: true },
  });
  const abatido = Number(credito._sum.valor ?? 0);
  const valorDevolvido = quantidade * custoDeEntradaDaLinha(linha);

  await db.purchaseReconciliationItem.update({
    where: { id: linha.id },
    data: {
      resolucao: "AJUSTADO",
      motivoDivergencia: `Devolvido ao fornecedor (${dev.numero}): ${motivo.trim()}`,
    },
  });

  await registrarEvento({
    tenantId,
    purchaseOrderId: linha.purchaseOrderId,
    inboundId: linha.inboundId,
    receiptId: linha.receiptId,
    purchaseId: entrada?.id ?? null,
    tipo: "DEVOLUCAO_REGISTRADA",
    descricao:
      `${linha.descricao}: ${quantidade} devolvido(s) ao fornecedor na devolução ${dev.numero} — ${motivo.trim()}.` +
      (abatido > 0.005
        ? ` R$ ${abatido.toFixed(2)} abatidos de títulos em aberto.`
        : " Nenhum título em aberto para abater."),
    meta: { quantidade, motivo: motivo.trim(), returnId: dev.id, abatido },
    createdBy: userId,
  });

  return {
    numero: dev.numero,
    abatido,
    sobra: Math.max(0, Math.round((valorDevolvido - abatido) * 100) / 100),
  };
}

/** Uma pessoa do fornecedor para quem a reclamação pode ir. */
export type ContatoParaAviso = {
  id: string;
  nome: string;
  cargo: string | null;
  telefone: string | null;
  email: string | null;
  principal: boolean;
};

/** "07/10/2026" no dia da loja — o servidor roda em UTC. */
const diaDaNota = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/**
 * Texto pronto da reclamação, com os números da conferência. Existe porque o
 * desfecho real de uma divergência acontece FORA do sistema — no WhatsApp do
 * representante — e reescrever isso à mão, item a item, é o que faz o operador
 * desistir e "deixar passar".
 *
 * É do RECEBIMENTO, não da nota: o pedido que chegou sem XML também tem
 * caminhão com caixa faltando, e é a contagem da doca — não só o que a nota
 * trouxe diferente do pedido — que mais vira reclamação.
 *
 * Vem com os CONTATOS do fornecedor: o telefone do cadastro costuma ser o do
 * faturamento (é o que o XML traz), e a reclamação é para o vendedor.
 */
export async function resumoDivergenciasParaFornecedor(input: {
  tenantId: string;
  receiptId: string;
  empresa: string;
}): Promise<{
  texto: string;
  fornecedor: string;
  telefone: string | null;
  email: string | null;
  contatos: ContatoParaAviso[];
}> {
  const receipt = await db.goodsReceipt.findFirst({
    where: { id: input.receiptId },
    select: {
      numero: true,
      numeroNota: true,
      iniciadoEm: true,
      fornecedorLivre: true,
      supplierId: true,
      purchaseOrder: { select: { numero: true } },
      supplier: { select: { razaoSocial: true, nomeFantasia: true, telefone: true, email: true } },
      inbound: {
        select: {
          numero: true,
          serie: true,
          dataEmissao: true,
          emitRazaoSocial: true,
        },
      },
    },
  });
  if (!receipt) throw new Error("Recebimento não encontrado.");

  const linhas = await db.purchaseReconciliationItem.findMany({
    where: { receiptId: input.receiptId },
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
      inboundItemId: true,
      purchaseOrderItemId: true,
    },
  });

  const nota = receipt.inbound;
  const itens = frasesDeDivergencia(
    linhas.map((l) => ({
      descricao: l.descricao,
      status: l.status,
      qtdPedida: Number(l.qtdPedida),
      qtdFaturada: Number(l.qtdFaturada),
      qtdRecebida: l.qtdRecebida == null ? null : Number(l.qtdRecebida),
      custoPedido: Number(l.custoPedido),
      custoFaturado: Number(l.custoFaturado),
      motivoDivergencia: l.motivoDivergencia,
      avulsa: !l.inboundItemId && !l.purchaseOrderItemId,
    })),
    { temNota: Boolean(nota) },
  );
  if (itens.length === 0) throw new Error("Este recebimento não tem divergência para relatar.");

  const documento = nota
    ? `a NF ${nota.numero}/${nota.serie} de ${diaDaNota(nota.dataEmissao)}`
    : receipt.numeroNota
      ? `a nota ${receipt.numeroNota}`
      : `a entrega de ${diaDaNota(receipt.iniciadoEm)}`;

  const comMotivo = linhas.filter(
    (l) => l.motivoDivergencia && itens.some((i) => i.startsWith(`• ${l.descricao}:`)),
  );
  const texto = [
    `Olá! Sobre ${documento}` +
      (receipt.purchaseOrder ? ` (nosso pedido ${receipt.purchaseOrder.numero})` : "") +
      ":",
    "",
    ...itens,
    ...(comMotivo.length > 0
      ? [
          "",
          "Observações da conferência:",
          ...comMotivo.map((l) => `• ${l.descricao}: ${l.motivoDivergencia}`),
        ]
      : []),
    "",
    "Podem confirmar como resolvemos? Obrigado.",
    input.empresa,
  ].join("\n");

  const contatos = receipt.supplierId
    ? await db.supplierContact.findMany({
        where: { supplierId: receipt.supplierId, ativo: true },
        select: {
          id: true,
          nome: true,
          cargo: true,
          telefone: true,
          email: true,
          principal: true,
        },
        orderBy: [{ principal: "desc" }, { nome: "asc" }],
      })
    : [];

  const s = receipt.supplier;
  return {
    texto,
    fornecedor:
      s?.nomeFantasia ?? s?.razaoSocial ?? nota?.emitRazaoSocial ?? receipt.fornecedorLivre ?? "Fornecedor",
    telefone: s?.telefone ?? null,
    email: s?.email ?? null,
    contatos,
  };
}

const escaparHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/**
 * Manda a reclamação por e-mail, com a planilha da conferência anexada — o
 * papel que o fornecedor precisa para dar o crédito sem pedir "me manda os
 * números". O texto é o que a pessoa revisou na tela, não um gerado de novo.
 *
 * WhatsApp oficial não entra aqui: mensagem que a empresa inicia só sai por
 * template aprovado, e o do tenant é o de cotação. Lá o caminho segue sendo o
 * link `wa.me` para o contato escolhido.
 */
export async function enviarAvisoPorEmail(input: {
  tenantId: string;
  receiptId: string;
  email: string;
  nomeContato?: string | null;
  texto: string;
  empresa: string;
  userId?: string | null;
}): Promise<void> {
  const receipt = await db.goodsReceipt.findFirst({
    where: { id: input.receiptId },
    select: {
      id: true,
      numero: true,
      numeroNota: true,
      purchaseOrderId: true,
      inboundId: true,
      inbound: { select: { numero: true, serie: true } },
    },
  });
  if (!receipt) throw new Error("Recebimento não encontrado.");

  const linhas = await db.purchaseReconciliationItem.findMany({
    where: { receiptId: receipt.id },
    select: {
      descricao: true,
      codigoFornecedor: true,
      ean: true,
      status: true,
      qtdPedida: true,
      qtdFaturada: true,
      qtdRecebida: true,
      custoPedido: true,
      custoFaturado: true,
      bonificacao: true,
      lote: true,
      validade: true,
      lotes: true,
      motivoDivergencia: true,
      inboundItemId: true,
      inboundItem: { select: { ordem: true, descricao: true } },
      createdAt: true,
    },
  });
  // A ordem e o texto DA NOTA: é a linguagem do fornecedor, e é como ele acha
  // o item no sistema dele.
  linhas.sort(
    (a, b) =>
      (a.inboundItem?.ordem ?? Number.MAX_SAFE_INTEGER) -
        (b.inboundItem?.ordem ?? Number.MAX_SAFE_INTEGER) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const planilha = gerarXlsx({
    aba: "Conferência",
    cabecalho: [
      "#",
      "Produto",
      "Código do fornecedor",
      "EAN",
      "Esperado (UN)",
      "Recebido (UN)",
      "Diferença",
      "Custo unitário (R$)",
      "Lote",
      "Validade",
      "Observação",
    ],
    linhas: linhas.map((l, i) => {
      const esperado = esperadoDaLinha(l);
      const recebido = l.qtdRecebida == null ? null : Number(l.qtdRecebida);
      const dia = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
      // A linha dividida em lotes sai com cada lote e a sua quantidade.
      const lotes = lotesDoJson(l.lotes);
      return [
        i + 1,
        l.inboundItem?.descricao ?? l.descricao,
        l.codigoFornecedor ?? "",
        l.ean ?? "",
        esperado,
        recebido,
        recebido == null ? null : recebido - esperado,
        l.bonificacao ? 0 : Math.round(custoDeEntradaDaLinha(l) * 100) / 100,
        lotes
          ? lotes.map((x) => `${x.lote ?? "sem lote"} (${x.quantidade})`).join("; ")
          : (l.lote ?? ""),
        lotes
          ? lotes.map((x) => (x.validade ? dia(x.validade) : "—")).join("; ")
          : l.validade
            ? dia(l.validade.toISOString())
            : "",
        l.motivoDivergencia ?? "",
      ];
    }),
  });

  const documento = receipt.inbound
    ? `NF ${receipt.inbound.numero}/${receipt.inbound.serie}`
    : receipt.numeroNota
      ? `nota ${receipt.numeroNota}`
      : `recebimento ${receipt.numero}`;

  const r = await enviarEmail({
    para: input.email,
    assunto: `Divergência na entrega — ${documento} — ${input.empresa}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${escaparHtml(
      input.texto,
    ).replace(/\n/g, "<br>")}</div>`,
    texto: input.texto,
    anexos: [{ nome: `conferencia-${receipt.numero}.xlsx`, conteudo: planilha }],
  });
  if (!r.ok) throw new Error(`O e-mail não saiu: ${r.erro}`);

  await registrarEvento({
    tenantId: input.tenantId,
    purchaseOrderId: receipt.purchaseOrderId,
    inboundId: receipt.inboundId,
    receiptId: receipt.id,
    tipo: "FORNECEDOR_AVISADO",
    descricao: `Divergência enviada por e-mail para ${
      input.nomeContato ? `${input.nomeContato} (${input.email})` : input.email
    }, com a planilha da conferência.`,
    createdBy: input.userId,
  });
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
      receiptId: true,
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
    receiptId: linha.receiptId,
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
