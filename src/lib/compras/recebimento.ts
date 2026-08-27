import "server-only";
import { db } from "@/lib/prisma";
import { proximoNumeroDocumento } from "@/lib/numeracao";
import { registrarEntrada, type EntradaItem, type TipoItemPedido } from "@/lib/estoque";
import { gerarTitulosDaNota } from "@/lib/financeiro/contas-pagar";
import { atualizarCustoDeReferencia } from "@/lib/fiscal/enriquecer-produto";
import { registrarEvento } from "./eventos";
import { TOL_QTD } from "./conciliacao-regras";
import {
  divergenciasDaConferencia,
  esperadoDaLinha,
  statusDoPedidoPeloSaldo,
  type Divergencia,
} from "./recebimento-regras";
import type {
  GoodsReceiptOrigem,
  GoodsReceiptStatus,
  PurchaseOrderStatus,
} from "@/generated/prisma";

// ============================================================
// RECEBIMENTO — a entidade da doca.
//
// Pedido e Recebimento são coisas diferentes do mesmo fluxo de compra:
//
//   PEDIDO      responde "o que eu comprei?"
//   RECEBIMENTO responde "o que chegou?"
//   NF-e        responde "qual documento fiscal cobre isto?"
//
// O pedido NÃO vira recebimento. Ele continua existindo e pode gerar zero, um
// ou vários recebimentos — e cada recebimento tem o seu próprio ciclo, que
// corre em paralelo ao do pedido ("pedido confirmado" + "recebimento em
// conferência" é combinação normal, não contradição).
//
// As três portas terminam aqui:
//
//   pedido        → iniciarRecebimentoDoPedido
//   XML           → garantirRecebimentoDaNota      (ver conciliacao.ts)
//   nada          → abrirRecebimentoAvulso
//
// …e todas fecham por `finalizarRecebimento`, que é o ÚNICO ponto em que o
// estoque se move. Pedido nenhum movimenta saldo.
//
// Tudo aqui trabalha em UNIDADE BASE do estoque (o mesmo contrato da
// conciliação): o pedido fala em caixa, a nota em fardo, a doca conta peça.
//
// Todas as funções assumem contexto de tenant ativo (runWithTenant no chamador).
// ============================================================

/** Status de pedido que ainda esperam mercadoria — podem abrir recebimento. */
export const PEDIDOS_RECEBIVEIS: PurchaseOrderStatus[] = [
  "ENVIADO",
  "AGUARDANDO",
  "EM_TRANSITO",
  "RECEBIDO_PARCIAL",
];

/** Recebimento ainda em curso — ocupa a doca, não entrou no estoque. */
export const RECEBIMENTOS_ABERTOS: GoodsReceiptStatus[] = [
  "PENDENTE",
  "EM_CONFERENCIA",
  "DIVERGENCIA",
];

export type RecebimentoResumo = {
  id: string;
  numero: string;
  status: GoodsReceiptStatus;
  origem: GoodsReceiptOrigem;
  purchaseOrderId: string | null;
  inboundId: string | null;
};

const resumo = (r: {
  id: string;
  numero: string;
  status: GoodsReceiptStatus;
  origem: GoodsReceiptOrigem;
  purchaseOrderId: string | null;
  inboundId: string | null;
}): RecebimentoResumo => r;

// ── Abertura ────────────────────────────────────────────────

/**
 * "Iniciar recebimento" a partir de um pedido.
 *
 * Idempotente de propósito: se já existe um recebimento aberto para este
 * pedido, ele é devolvido em vez de um novo ser criado. Quem clica duas vezes
 * no botão quer continuar a conferência que começou, não abrir uma segunda —
 * o segundo recebimento nasce quando o segundo caminhão chega, não quando o
 * navegador recarrega.
 *
 * As linhas nascem com o SALDO do pedido (o que ainda não chegou), não com o
 * pedido inteiro: o segundo recebimento de um pedido 100 que já recebeu 60
 * abre esperando 40.
 */
export async function iniciarRecebimentoDoPedido(input: {
  tenantId: string;
  purchaseOrderId: string;
  userId?: string | null;
}): Promise<RecebimentoResumo> {
  const { tenantId, purchaseOrderId, userId } = input;

  const aberto = await db.goodsReceipt.findFirst({
    where: { purchaseOrderId, status: { in: RECEBIMENTOS_ABERTOS } },
    select: { id: true, numero: true, status: true, origem: true, purchaseOrderId: true, inboundId: true },
    orderBy: { iniciadoEm: "desc" },
  });
  if (aberto) return resumo(aberto);

  const pedido = await db.purchaseOrder.findFirst({
    where: { id: purchaseOrderId },
    select: {
      id: true,
      numero: true,
      status: true,
      siteId: true,
      supplierId: true,
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
  if (pedido.status === "RASCUNHO") {
    throw new Error("Envie o pedido ao fornecedor antes de receber a mercadoria.");
  }
  if (pedido.status === "RECEBIDO") {
    throw new Error("Este pedido já foi recebido por completo.");
  }

  const fatores = await fatoresDe(pedido.items.map((i) => i.packagingId));
  const nomes = await nomesDeProdutos(pedido.items.map((i) => i.productId));

  // Saldo em unidade base. Linha já atendida não entra: conferir de novo o que
  // chegou na semana passada é como o operador acaba recebendo em dobro.
  const linhas = pedido.items
    .map((i) => {
      const fator = (i.packagingId ? fatores.get(i.packagingId) : null) ?? 1;
      const saldo = (Number(i.qtdPedida) - Number(i.qtdRecebida)) * fator;
      return {
        purchaseOrderItemId: i.id,
        productId: i.productId,
        descricao: nomes.get(i.productId) ?? "Produto do pedido",
        qtdPedida: saldo,
        // Sem nota, "faturado" é o que o pedido diz que deveria vir: é isso
        // que a tela pré-preenche para o operador só confirmar ou corrigir.
        qtdFaturada: saldo,
        custoPedido: fator > 0 ? Number(i.custoUnitario) / fator : 0,
        custoFaturado: fator > 0 ? Number(i.custoUnitario) / fator : 0,
        bonificacao: i.tipo !== "COMPRA",
      };
    })
    .filter((l) => l.qtdPedida > TOL_QTD);

  if (linhas.length === 0) {
    throw new Error("Não há saldo pendente neste pedido — tudo já foi recebido.");
  }

  const numero = await proximoNumeroDocumento(tenantId, "REC");
  const receipt = await db.goodsReceipt.create({
    data: {
      tenantId,
      siteId: pedido.siteId,
      numero,
      status: "EM_CONFERENCIA",
      origem: "PEDIDO",
      purchaseOrderId: pedido.id,
      supplierId: pedido.supplierId,
      createdBy: userId ?? null,
      itens: {
        create: linhas.map((l) => ({
          tenantId,
          purchaseOrderId: pedido.id,
          purchaseOrderItemId: l.purchaseOrderItemId,
          productId: l.productId,
          descricao: l.descricao,
          qtdPedida: l.qtdPedida,
          qtdFaturada: l.qtdFaturada,
          custoPedido: l.custoPedido,
          custoFaturado: l.custoFaturado,
          bonificacao: l.bonificacao,
          status: "OK" as const,
        })),
      },
    },
    select: { id: true, numero: true, status: true, origem: true, purchaseOrderId: true, inboundId: true },
  });

  await registrarEvento({
    tenantId,
    purchaseOrderId: pedido.id,
    receiptId: receipt.id,
    tipo: "RECEBIMENTO_INICIADO",
    descricao: `Recebimento ${numero} aberto para o pedido ${pedido.numero} — ${linhas.length} ${
      linhas.length === 1 ? "item a conferir" : "itens a conferir"
    }.`,
    createdBy: userId,
  });

  return resumo(receipt);
}

/**
 * Mercadoria que chegou sem pedido e sem nota. Nasce vazio: quem confere
 * adiciona o que tem na mão.
 *
 * Não cria pedido retroativo. O recebimento avulso É o documento do que
 * entrou — inventar um pedido que ninguém fez faz a tela de Pedidos mentir
 * sobre o que a loja comprou.
 */
export async function abrirRecebimentoAvulso(input: {
  tenantId: string;
  siteId: string;
  supplierId?: string | null;
  fornecedorLivre?: string | null;
  observacao?: string | null;
  userId?: string | null;
}): Promise<RecebimentoResumo> {
  const numero = await proximoNumeroDocumento(input.tenantId, "REC");
  const receipt = await db.goodsReceipt.create({
    data: {
      tenantId: input.tenantId,
      siteId: input.siteId,
      numero,
      status: "EM_CONFERENCIA",
      origem: "AVULSO",
      supplierId: input.supplierId ?? null,
      fornecedorLivre: input.fornecedorLivre?.trim() || null,
      observacao: input.observacao ?? null,
      createdBy: input.userId ?? null,
    },
    select: { id: true, numero: true, status: true, origem: true, purchaseOrderId: true, inboundId: true },
  });

  await registrarEvento({
    tenantId: input.tenantId,
    purchaseOrderId: null,
    receiptId: receipt.id,
    tipo: "RECEBIMENTO_INICIADO",
    descricao: `Recebimento avulso ${numero} aberto — sem pedido e sem nota.`,
    createdBy: input.userId,
  });

  return resumo(receipt);
}

/**
 * O recebimento de uma nota. Criado na primeira vez que alguém abre o XML e
 * reaproveitado depois — a nota tem UM recebimento (`inboundId` é único).
 */
export async function garantirRecebimentoDaNota(input: {
  tenantId: string;
  inboundId: string;
  userId?: string | null;
}): Promise<RecebimentoResumo> {
  const existente = await db.goodsReceipt.findFirst({
    where: { inboundId: input.inboundId },
    select: { id: true, numero: true, status: true, origem: true, purchaseOrderId: true, inboundId: true },
  });
  if (existente) return resumo(existente);

  const nota = await db.fiscalInbound.findFirst({
    where: { id: input.inboundId },
    select: {
      id: true,
      siteId: true,
      supplierId: true,
      purchaseOrderId: true,
      status: true,
      numero: true,
      serie: true,
      dataEmissao: true,
      emitRazaoSocial: true,
      importadoPor: true,
    },
  });
  if (!nota) throw new Error("Nota não encontrada.");

  const numero = await proximoNumeroDocumento(input.tenantId, "REC");
  const receipt = await db.goodsReceipt.create({
    data: {
      tenantId: input.tenantId,
      siteId: nota.siteId,
      numero,
      // Nota sem de-para não dá para começar a contar: o item ainda não é um
      // produto do catálogo.
      status: nota.status === "PENDENTE" ? "PENDENTE" : "EM_CONFERENCIA",
      origem: "XML",
      inboundId: nota.id,
      purchaseOrderId: nota.purchaseOrderId,
      supplierId: nota.supplierId,
      fornecedorLivre: nota.supplierId ? null : nota.emitRazaoSocial,
      iniciadoEm: nota.dataEmissao,
      createdBy: input.userId ?? nota.importadoPor ?? null,
    },
    select: { id: true, numero: true, status: true, origem: true, purchaseOrderId: true, inboundId: true },
  });

  await registrarEvento({
    tenantId: input.tenantId,
    purchaseOrderId: nota.purchaseOrderId,
    inboundId: nota.id,
    receiptId: receipt.id,
    tipo: "RECEBIMENTO_INICIADO",
    descricao: `Recebimento ${numero} aberto pela NF-e ${nota.numero}/${nota.serie}.`,
    createdBy: input.userId,
  });

  return resumo(receipt);
}

// ── Vínculos que podem chegar depois ────────────────────────

/**
 * A NF-e chegou DEPOIS da mercadoria. Documenta um recebimento que já existe
 * em vez de abrir outro — é isto que impede a mesma carga de entrar duas vezes.
 *
 * Funciona com o recebimento aberto (o XML vira a referência da conferência em
 * curso) e com o já finalizado (o documento só se pendura no que entrou).
 */
export async function vincularNotaAoRecebimento(input: {
  tenantId: string;
  receiptId: string;
  inboundId: string;
  userId?: string | null;
}): Promise<void> {
  const { tenantId, receiptId, inboundId, userId } = input;

  const receipt = await db.goodsReceipt.findFirst({
    where: { id: receiptId },
    select: { id: true, numero: true, status: true, siteId: true, inboundId: true, purchaseOrderId: true },
  });
  if (!receipt) throw new Error("Recebimento não encontrado.");
  if (receipt.inboundId && receipt.inboundId !== inboundId) {
    throw new Error("Este recebimento já tem uma nota fiscal vinculada.");
  }

  const nota = await db.fiscalInbound.findFirst({
    where: { id: inboundId },
    select: { id: true, numero: true, serie: true, chave: true, siteId: true, status: true, supplierId: true },
  });
  if (!nota) throw new Error("Nota não encontrada.");
  if (nota.status === "RECEBIDO") {
    throw new Error("Esta nota já gerou entrada de estoque por outro caminho.");
  }
  if (nota.siteId !== receipt.siteId) {
    throw new Error("A nota é de outra loja — a mercadoria entraria no lugar errado.");
  }

  const jaVinculada = await db.goodsReceipt.findFirst({
    where: { inboundId, id: { not: receiptId } },
    select: { numero: true },
  });
  if (jaVinculada) {
    throw new Error(`Esta nota já documenta o recebimento ${jaVinculada.numero}.`);
  }

  await db.goodsReceipt.update({
    where: { id: receiptId },
    data: {
      inboundId,
      supplierId: nota.supplierId ?? undefined,
    },
  });

  // Recebimento já fechado: a nota documenta o que entrou, e o estoque NÃO se
  // move de novo. É o mesmo contrato de `vincularNotaAEntradaManual`.
  const encerrado = receipt.status === "FINALIZADO";
  if (encerrado) {
    await db.purchase.updateMany({
      where: { receiptId },
      data: {
        aguardandoDocumento: false,
        chaveNfe: nota.chave,
        documentoVinculadoEm: new Date(),
        numeroNota: `${nota.numero}/${nota.serie}`,
      },
    });
    const entrada = await db.purchase.findFirst({
      where: { receiptId },
      select: { id: true },
      orderBy: { data: "asc" },
    });
    await db.fiscalInbound.update({
      where: { id: inboundId },
      data: {
        status: "VINCULADO",
        purchaseId: entrada?.id ?? null,
        purchaseOrderId: receipt.purchaseOrderId,
        semEstoqueMotivo:
          "Documenta um recebimento já finalizado — o estoque não foi movimentado de novo.",
        conciliadoEm: new Date(),
      },
    });
  } else {
    await db.purchaseReconciliationItem.updateMany({
      where: { receiptId },
      data: { inboundId },
    });
    await db.fiscalInbound.update({
      where: { id: inboundId },
      data: { purchaseOrderId: receipt.purchaseOrderId, conciliadoEm: new Date() },
    });
  }

  await registrarEvento({
    tenantId,
    purchaseOrderId: receipt.purchaseOrderId,
    inboundId,
    receiptId,
    tipo: "DOCUMENTO_VINCULADO",
    descricao: encerrado
      ? `NF-e ${nota.numero}/${nota.serie} documentou o recebimento ${receipt.numero} — estoque não movimentado de novo.`
      : `NF-e ${nota.numero}/${nota.serie} vinculada ao recebimento ${receipt.numero}.`,
    createdBy: userId,
  });
}

/**
 * O recebimento avulso era, afinal, de um pedido. Liga os dois sem refazer a
 * contagem — as linhas ganham o pedido, e o saldo é acertado no fechamento.
 */
export async function vincularPedidoAoRecebimento(input: {
  tenantId: string;
  receiptId: string;
  purchaseOrderId: string;
  userId?: string | null;
}): Promise<void> {
  const receipt = await db.goodsReceipt.findFirst({
    where: { id: input.receiptId },
    select: { id: true, numero: true, status: true, siteId: true, purchaseOrderId: true },
  });
  if (!receipt) throw new Error("Recebimento não encontrado.");
  if (receipt.status === "FINALIZADO") {
    throw new Error("Recebimento finalizado — o vínculo com o pedido não muda mais.");
  }

  const pedido = await db.purchaseOrder.findFirst({
    where: { id: input.purchaseOrderId },
    select: { id: true, numero: true, siteId: true, status: true },
  });
  if (!pedido) throw new Error("Pedido não encontrado.");
  if (pedido.status === "CANCELADO") throw new Error("Este pedido está cancelado.");
  if (pedido.siteId !== receipt.siteId) {
    throw new Error("O pedido é de outra loja — a mercadoria entraria no lugar errado.");
  }

  await db.goodsReceipt.update({
    where: { id: receipt.id },
    data: { purchaseOrderId: pedido.id },
  });
  await db.purchaseReconciliationItem.updateMany({
    where: { receiptId: receipt.id },
    data: { purchaseOrderId: pedido.id },
  });

  await registrarEvento({
    tenantId: input.tenantId,
    purchaseOrderId: pedido.id,
    receiptId: receipt.id,
    tipo: "VINCULO_ALTERADO",
    descricao: `Recebimento ${receipt.numero} vinculado ao pedido ${pedido.numero}.`,
    createdBy: input.userId,
  });
}

// ── Itens conferidos fora do que se esperava ────────────────

/**
 * Mercadoria conferida que não estava na expectativa (item a mais no
 * caminhão, ou a linha inteira, no avulso).
 *
 * Vira uma linha NAO_PEDIDO do recebimento — visível para sempre como "veio e
 * ninguém pediu", em vez de sumir dentro de um ajuste de estoque sem dono.
 */
export async function adicionarItemAoRecebimento(input: {
  tenantId: string;
  receiptId: string;
  productId: string;
  /** Quantidade JÁ em unidade base do estoque. */
  quantidade: number;
  custoUnitario: number;
  lote?: string | null;
  validade?: string | null;
  bonificacao?: boolean;
  motivo?: string | null;
}): Promise<string> {
  const receipt = await db.goodsReceipt.findFirst({
    where: { id: input.receiptId },
    select: { id: true, status: true, purchaseOrderId: true, inboundId: true },
  });
  if (!receipt) throw new Error("Recebimento não encontrado.");
  if (receipt.status === "FINALIZADO" || receipt.status === "CANCELADO") {
    throw new Error("Este recebimento está encerrado.");
  }

  const produto = await db.product.findFirst({
    where: { id: input.productId },
    select: { id: true, nome: true, ean: true },
  });
  if (!produto) throw new Error("Produto não encontrado.");

  const linha = await db.purchaseReconciliationItem.create({
    data: {
      tenantId: input.tenantId,
      receiptId: receipt.id,
      inboundId: receipt.inboundId,
      purchaseOrderId: receipt.purchaseOrderId,
      productId: produto.id,
      ean: produto.ean,
      descricao: produto.nome,
      qtdPedida: 0,
      qtdFaturada: 0,
      qtdRecebida: input.quantidade,
      custoPedido: 0,
      custoFaturado: input.bonificacao ? 0 : input.custoUnitario,
      bonificacao: input.bonificacao ?? false,
      status: "NAO_PEDIDO",
      lote: input.lote?.trim() || null,
      validade: input.validade ? new Date(`${input.validade}T00:00:00`) : null,
      motivoDivergencia: input.motivo?.trim() || null,
    },
    select: { id: true },
  });

  await marcarEmConferencia(receipt.id);
  return linha.id;
}

/** Remove uma linha adicionada por engano. Só o que veio "a mais" some. */
export async function removerItemDoRecebimento(input: {
  receiptId: string;
  itemId: string;
}): Promise<void> {
  const linha = await db.purchaseReconciliationItem.findFirst({
    where: { id: input.itemId, receiptId: input.receiptId },
    select: { id: true, purchaseOrderItemId: true, inboundItemId: true },
  });
  if (!linha) throw new Error("Item não encontrado neste recebimento.");
  if (linha.purchaseOrderItemId || linha.inboundItemId) {
    throw new Error(
      "Esta linha veio do pedido ou da nota — zere a contagem em vez de apagar, para a diferença continuar visível.",
    );
  }
  await db.purchaseReconciliationItem.delete({ where: { id: linha.id } });
}

// ── Progresso do pedido ─────────────────────────────────────

export type ProgressoPedido = {
  /** Total pedido, na unidade de compra. */
  pedido: number;
  /** Total já recebido (soma dos recebimentos finalizados). */
  recebido: number;
  /** 0..1 */
  fracao: number;
  /** Há recebimento em curso agora? */
  emAndamento: boolean;
  recebimentos: number;
};

/**
 * "60/100 — 60%" para a tela de Pedidos.
 *
 * A conta vem de `qtdRecebida` dos itens (que só se move quando um recebimento
 * é finalizado), não da contagem de recebimentos: dois recebimentos podem
 * somar 40% e um só pode somar 100%.
 */
export async function progressoDosPedidos(
  purchaseOrderIds: string[],
): Promise<Map<string, ProgressoPedido>> {
  const ids = [...new Set(purchaseOrderIds)].filter(Boolean);
  const mapa = new Map<string, ProgressoPedido>();
  if (ids.length === 0) return mapa;

  const [itens, recebimentos] = await Promise.all([
    db.purchaseOrderItem.findMany({
      where: { purchaseOrderId: { in: ids } },
      select: { purchaseOrderId: true, qtdPedida: true, qtdRecebida: true },
    }),
    db.goodsReceipt.findMany({
      where: { purchaseOrderId: { in: ids } },
      select: { purchaseOrderId: true, status: true },
    }),
  ]);

  for (const id of ids) {
    mapa.set(id, { pedido: 0, recebido: 0, fracao: 0, emAndamento: false, recebimentos: 0 });
  }
  for (const i of itens) {
    const p = mapa.get(i.purchaseOrderId);
    if (!p) continue;
    p.pedido += Number(i.qtdPedida);
    p.recebido += Math.min(Number(i.qtdRecebida), Number(i.qtdPedida));
  }
  for (const r of recebimentos) {
    const p = r.purchaseOrderId ? mapa.get(r.purchaseOrderId) : null;
    if (!p) continue;
    p.recebimentos += 1;
    if (RECEBIMENTOS_ABERTOS.includes(r.status)) p.emAndamento = true;
  }
  for (const p of mapa.values()) {
    p.fracao = p.pedido > 0 ? Math.min(1, p.recebido / p.pedido) : 0;
  }
  return mapa;
}

// ── Fechamento ──────────────────────────────────────────────

/** Marca o recebimento como "alguém está contando" sem apagar DIVERGENCIA. */
export async function marcarEmConferencia(receiptId: string): Promise<void> {
  await db.goodsReceipt.updateMany({
    where: { id: receiptId, status: "PENDENTE" },
    data: { status: "EM_CONFERENCIA" },
  });
}

/**
 * Recebimento abandonado. Não apaga nada: a conferência que existiu é um fato,
 * e some do caminho por status, não por DELETE.
 */
export async function cancelarRecebimento(input: {
  tenantId: string;
  receiptId: string;
  motivo: string;
  userId?: string | null;
}): Promise<void> {
  const receipt = await db.goodsReceipt.findFirst({
    where: { id: input.receiptId },
    select: { id: true, numero: true, status: true, purchaseOrderId: true, inboundId: true },
  });
  if (!receipt) throw new Error("Recebimento não encontrado.");
  if (receipt.status === "FINALIZADO") {
    throw new Error("Recebimento já finalizado — use o estorno da entrada.");
  }
  if (receipt.status === "CANCELADO") return;

  await db.goodsReceipt.update({
    where: { id: receipt.id },
    data: {
      status: "CANCELADO",
      canceladoEm: new Date(),
      canceladoMotivo: input.motivo.trim(),
    },
  });

  // A nota volta para a fila: cancelar a conferência não descarta o documento.
  if (receipt.inboundId) {
    await db.goodsReceipt.update({ where: { id: receipt.id }, data: { inboundId: null } });
    await db.fiscalInbound.update({
      where: { id: receipt.inboundId },
      data: { conciliadoEm: null },
    });
  }

  await registrarEvento({
    tenantId: input.tenantId,
    purchaseOrderId: receipt.purchaseOrderId,
    inboundId: receipt.inboundId,
    receiptId: receipt.id,
    tipo: "RECEBIMENTO_CANCELADO",
    descricao: `Recebimento ${receipt.numero} cancelado: ${input.motivo.trim()}`,
    createdBy: input.userId,
  });
}

export { divergenciasDaConferencia, statusDoPedidoPeloSaldo, esperadoDaLinha };
export type { Divergencia };

// ── Auxiliares ──────────────────────────────────────────────

export async function fatoresDe(ids: (string | null)[]): Promise<Map<string, number>> {
  const unicos = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  if (unicos.length === 0) return new Map();
  const pacotes = await db.productPackaging.findMany({
    where: { id: { in: unicos } },
    select: { id: true, fatorConversao: true },
  });
  return new Map(pacotes.map((p) => [p.id, Number(p.fatorConversao)]));
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

// ============================================================
// FECHAMENTO — o único ponto em que o estoque se move.
//
// Vale para as três origens: pedido, XML e avulso. O que muda entre elas é de
// onde vieram as linhas, não o que acontece no fim — por isso existe uma
// função só. Duas funções de fechar recebimento são dois custos médios para a
// mesma caixa, mais cedo ou mais tarde.
// ============================================================

/** Mapa tipo do item do pedido → motivo da entrada de estoque, quando != COMPRA. */
const MOTIVO_POR_TIPO: Record<
  Exclude<TipoItemPedido, "COMPRA">,
  "BONIFICACAO" | "BRINDE" | "TROCA" | "AMOSTRA" | "SERVICO"
> = {
  BONIFICACAO: "BONIFICACAO",
  BRINDE: "BRINDE",
  TROCA: "TROCA",
  AMOSTRA: "AMOSTRA",
  SERVICO: "SERVICO",
};

const MOTIVO_LABEL: Record<"BONIFICACAO" | "BRINDE" | "TROCA" | "AMOSTRA" | "SERVICO", string> = {
  BONIFICACAO: "bonificação",
  BRINDE: "brinde",
  TROCA: "troca",
  AMOSTRA: "amostra",
  SERVICO: "serviço",
};

export type ResultadoRecebimento = {
  receiptId: string;
  numero: string;
  /** Entrada de COMPRA gerada (a que vira dívida). null = só bonificação. */
  purchaseId: string | null;
  /** Valor da mercadoria comprada neste recebimento, pelo custo que entrou. */
  valorRecebido: number;
  /** O pedido ficou completo com este recebimento? */
  pedidoCompleto: boolean;
  purchaseOrderId: string | null;
  supplierId: string | null;
  siteId: string;
  itens: number;
};

/**
 * Fecha o recebimento: move o estoque, acumula o recebido no pedido, marca a
 * nota e escreve a história. É a ÚNICA função do módulo que mexe em saldo.
 *
 * O pedido NÃO some nem se transforma: ele apenas passa a RECEBIDO_PARCIAL ou
 * RECEBIDO conforme o saldo — e continua aceitando novos recebimentos até
 * fechar.
 *
 * Linha sem contagem entra pelo que se esperava (a nota, ou o pedido quando não
 * há nota) — a tela mostra quantas são antes de confirmar. Item sem produto
 * relacionado trava tudo: mercadoria sem cadastro é rastro perdido.
 */
export async function finalizarRecebimento(input: {
  tenantId: string;
  receiptId: string;
  /** Obrigatório quando a contagem não bate com o esperado. */
  motivoDivergencia?: string | null;
  gerarFinanceiro?: boolean;
  userId?: string | null;
}): Promise<ResultadoRecebimento> {
  const { tenantId, receiptId, userId } = input;

  const receipt = await db.goodsReceipt.findFirst({
    where: { id: receiptId },
    select: {
      id: true,
      numero: true,
      status: true,
      origem: true,
      siteId: true,
      supplierId: true,
      numeroNota: true,
      purchaseOrderId: true,
      inboundId: true,
      inbound: {
        select: {
          id: true,
          numero: true,
          serie: true,
          chave: true,
          status: true,
          supplierId: true,
          emitRazaoSocial: true,
        },
      },
      purchaseOrder: {
        select: { id: true, numero: true, status: true, financeiroGerado: true },
      },
    },
  });
  if (!receipt) throw new Error("Recebimento não encontrado.");
  if (receipt.status === "FINALIZADO") throw new Error("Este recebimento já foi finalizado.");
  if (receipt.status === "CANCELADO") throw new Error("Este recebimento foi cancelado.");
  if (receipt.inbound && receipt.inbound.status === "RECEBIDO") {
    throw new Error("A nota deste recebimento já gerou entrada de estoque.");
  }

  const linhas = await db.purchaseReconciliationItem.findMany({
    where: { receiptId },
    select: {
      id: true,
      productId: true,
      descricao: true,
      qtdPedida: true,
      qtdFaturada: true,
      qtdRecebida: true,
      custoPedido: true,
      custoFaturado: true,
      bonificacao: true,
      resolucao: true,
      motivoDivergencia: true,
      lote: true,
      validade: true,
      purchaseOrderItemId: true,
    },
  });
  if (linhas.length === 0) throw new Error("Não há nada conferido neste recebimento.");

  // Divergência sem justificativa vira, meses depois, a palavra do estoquista
  // contra a do fornecedor. Mesma régua da conferência por XML.
  const divergencias = divergenciasDaConferencia(linhas);
  const motivo = input.motivoDivergencia?.trim() || null;
  if (divergencias.length > 0 && !motivo) {
    const primeira = divergencias[0];
    throw new Error(
      `${
        divergencias.length === 1
          ? "Uma linha diverge"
          : `${divergencias.length} linhas divergem`
      } do esperado (ex.: ${primeira.descricao}, esperado ${fmtNum(
        primeira.esperado,
      )}, contado ${fmtNum(primeira.recebido)}). Explique a diferença antes de finalizar.`,
    );
  }

  const entrando = linhas
    .map((l) => ({
      ...l,
      qtd: l.qtdRecebida == null ? esperadoDaLinha(l) : Number(l.qtdRecebida),
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

  // O motivo fino da entrada sem custo (brinde × troca × amostra) mora no item
  // do PEDIDO. Sem pedido, tudo que é bonificado entra como BONIFICACAO.
  const orderItemIds = entrando
    .map((l) => l.purchaseOrderItemId)
    .filter((v): v is string => Boolean(v));
  const tiposDoPedido = orderItemIds.length
    ? new Map(
        (
          await db.purchaseOrderItem.findMany({
            where: { id: { in: orderItemIds } },
            select: { id: true, tipo: true },
          })
        ).map((i) => [i.id, i.tipo as TipoItemPedido]),
      )
    : new Map<string, TipoItemPedido>();

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

  const nota = receipt.inbound;
  const pedido = receipt.purchaseOrder;
  const numeroNota = nota ? `${nota.numero}/${nota.serie}` : receipt.numeroNota;
  const referencia = pedido
    ? `Recebimento ${receipt.numero} do pedido ${pedido.numero}${nota ? ` — nota ${numeroNota}` : ""}`
    : nota
      ? `Recebimento ${receipt.numero} sem pedido — nota ${numeroNota}`
      : `Recebimento avulso ${receipt.numero}`;

  const comprados = entrando.filter((l) => !l.bonificacao);
  const semCusto = entrando.filter((l) => l.bonificacao);
  const valorRecebido = comprados.reduce((a, l) => a + l.qtd * Number(l.custoFaturado), 0);

  // Sem XML a entrada nasce marcada esperando o documento — é o que impede a
  // mesma carga de entrar de novo quando a nota chegar.
  const aguardandoDocumento = !nota;

  let purchaseId: string | null = null;
  if (comprados.length > 0) {
    purchaseId = await registrarEntrada(tenantId, receipt.siteId, comprados.map(paraEntrada), {
      tipo: "FORNECEDOR",
      motivo: pedido ? null : "COMPRA_SEM_PEDIDO",
      supplierId: receipt.supplierId,
      purchaseOrderId: pedido?.id ?? null,
      receiptId: receipt.id,
      numero: receipt.numero,
      numeroNota,
      chaveNfe: nota?.chave ?? null,
      observacao: referencia,
      createdBy: userId ?? undefined,
      aguardandoDocumento,
    });
  }

  // Um grupo por motivo — cada um vira sua própria Purchase, sempre com custo
  // zero, para o histórico do produto e o financeiro não confundirem mercadoria
  // comprada com mercadoria ganha.
  const grupos = new Map<
    "BONIFICACAO" | "BRINDE" | "TROCA" | "AMOSTRA" | "SERVICO",
    typeof semCusto
  >();
  for (const l of semCusto) {
    const tipo = l.purchaseOrderItemId ? tiposDoPedido.get(l.purchaseOrderItemId) : null;
    const m =
      tipo && tipo !== "COMPRA"
        ? (MOTIVO_POR_TIPO[tipo as Exclude<TipoItemPedido, "COMPRA">] ?? "BONIFICACAO")
        : "BONIFICACAO";
    const g = grupos.get(m) ?? [];
    g.push(l);
    grupos.set(m, g);
  }
  for (const [m, grupo] of grupos) {
    const id = await registrarEntrada(tenantId, receipt.siteId, grupo.map(paraEntrada), {
      tipo: "FORNECEDOR",
      motivo: m,
      supplierId: receipt.supplierId,
      purchaseOrderId: pedido?.id ?? null,
      receiptId: receipt.id,
      numero: receipt.numero,
      numeroNota,
      chaveNfe: nota?.chave ?? null,
      observacao: `${referencia} — ${MOTIVO_LABEL[m]}`,
      createdBy: userId ?? undefined,
      aguardandoDocumento,
    });
    purchaseId ||= id;
  }

  // Acumula o recebido no pedido, de volta em unidade de compra. Sem pedido não
  // há saldo a acumular — o recebimento avulso é inteiro por definição.
  let pedidoCompleto = false;
  if (pedido) {
    const itensPedido = await db.purchaseOrderItem.findMany({
      where: { purchaseOrderId: pedido.id },
      select: { id: true, packagingId: true, qtdPedida: true, qtdRecebida: true },
    });
    const fatores = await fatoresDe(itensPedido.map((i) => i.packagingId));

    const porItem = new Map<string, number>();
    for (const l of entrando) {
      if (!l.purchaseOrderItemId) continue; // item fora do pedido não tem onde somar
      porItem.set(l.purchaseOrderItemId, (porItem.get(l.purchaseOrderItemId) ?? 0) + l.qtd);
    }

    const depois = itensPedido.map((it) => {
      const fator = (it.packagingId ? fatores.get(it.packagingId) : null) ?? 1;
      const acrescimo = (porItem.get(it.id) ?? 0) / (fator > 0 ? fator : 1);
      return { it, total: Number(it.qtdRecebida) + acrescimo, mudou: porItem.has(it.id) };
    });

    for (const d of depois) {
      if (!d.mudou) continue;
      await db.purchaseOrderItem.update({
        where: { id: d.it.id },
        data: { qtdRecebida: d.total },
      });
    }

    const novoStatus = statusDoPedidoPeloSaldo(
      depois.map((d) => ({ qtdPedida: d.it.qtdPedida, qtdRecebida: d.total })),
      pedido.status,
    );
    pedidoCompleto = novoStatus === "RECEBIDO";

    await db.purchaseOrder.update({
      where: { id: pedido.id },
      data: {
        status: novoStatus,
        recebidoEm: pedidoCompleto ? new Date() : null,
        financeiroGerado: input.gerarFinanceiro ? true : pedido.financeiroGerado,
      },
    });
  }

  if (nota) {
    await db.fiscalInbound.update({
      where: { id: nota.id },
      data: { status: "RECEBIDO", purchaseId: purchaseId || null },
    });
  }

  await db.goodsReceipt.update({
    where: { id: receipt.id },
    data: { status: "FINALIZADO", finalizadoEm: new Date(), divergenciaMotivo: motivo },
  });

  // Estoque e financeiro são o mesmo fato visto de dois lados. As duplicatas da
  // nota viram títulos aqui, no instante em que a mercadoria passa a ser nossa.
  if (nota) {
    const titulos = await gerarTitulosDaNota({
      tenantId,
      inboundId: nota.id,
      purchaseId: purchaseId || null,
      userId,
    });
    if (titulos.criados > 0) {
      await registrarEvento({
        tenantId,
        purchaseOrderId: pedido?.id ?? null,
        inboundId: nota.id,
        receiptId: receipt.id,
        tipo: "TITULOS_GERADOS",
        descricao: titulos.estimado
          ? `1 título a pagar de R$ ${titulos.valorTotal.toFixed(2)} — a nota não trouxe duplicata, o vencimento veio do prazo do fornecedor.`
          : `${titulos.criados} título(s) a pagar, somando R$ ${titulos.valorTotal.toFixed(2)}.`,
        meta: { criados: titulos.criados, valorTotal: titulos.valorTotal },
        createdBy: userId,
      });
    }
  }

  // Custo de referência do produto: agora o dinheiro é real, então o que se
  // pagou vira o "quanto custou da última vez" que o cadastro mostra.
  await atualizarCustoDeReferencia(
    comprados.map((l) => ({
      productId: l.productId as string,
      custoUnitarioBase: Number(l.custoFaturado),
    })),
  );

  // Cada linha fora do combinado deixa a SUA linha na história — pendurada no
  // recebimento, para o pedido com três entregas não virar um monólogo.
  for (const d of divergencias) {
    await registrarEvento({
      tenantId,
      purchaseOrderId: pedido?.id ?? null,
      inboundId: nota?.id ?? null,
      receiptId: receipt.id,
      purchaseId,
      tipo: "DIVERGENCIA_RESOLVIDA",
      descricao: `${d.descricao}: esperado ${fmtNum(d.esperado)}, recebido ${fmtNum(
        d.recebido,
      )} (${d.recebido > d.esperado ? "+" : ""}${fmtNum(d.recebido - d.esperado)}). ${motivo}`,
      meta: { esperado: d.esperado, recebido: d.recebido, motivo },
      createdBy: userId,
    });
  }

  await registrarEvento({
    tenantId,
    purchaseOrderId: pedido?.id ?? null,
    inboundId: nota?.id ?? null,
    receiptId: receipt.id,
    tipo: "CONFERENCIA_CONCLUIDA",
    descricao: `Recebimento ${receipt.numero} finalizado: ${entrando.length} ${
      entrando.length === 1 ? "item recebido" : "itens recebidos"
    }.`,
    createdBy: userId,
  });
  await registrarEvento({
    tenantId,
    purchaseOrderId: pedido?.id ?? null,
    inboundId: nota?.id ?? null,
    receiptId: receipt.id,
    purchaseId,
    tipo: "ESTOQUE_ATUALIZADO",
    descricao: !pedido
      ? `Estoque atualizado pelo recebimento ${receipt.numero}, sem pedido.`
      : pedidoCompleto
        ? `Estoque atualizado. Pedido ${pedido.numero} recebido integralmente.`
        : `Estoque atualizado. Pedido ${pedido.numero} segue com itens pendentes.`,
    meta: { purchaseId, itens: entrando.length },
    createdBy: userId,
  });

  return {
    receiptId: receipt.id,
    numero: receipt.numero,
    purchaseId,
    valorRecebido,
    pedidoCompleto,
    purchaseOrderId: pedido?.id ?? null,
    supplierId: receipt.supplierId,
    siteId: receipt.siteId,
    itens: entrando.length,
  };
}

// ── Contagem ────────────────────────────────────────────────

/**
 * Grava o que foi contado numa linha. `undefined` deixa o campo como está — a
 * tela salva um campo por vez, e o bipe manda só a quantidade; converter
 * ausente em null aqui apagaria lote e validade a cada leitura do scanner.
 */
export async function registrarContagem(input: {
  receiptId: string;
  itemId: string;
  qtdRecebida?: number | null;
  custoUnitario?: number | null;
  lote?: string | null;
  validade?: string | null;
  motivoDivergencia?: string | null;
}): Promise<void> {
  const linha = await db.purchaseReconciliationItem.findFirst({
    where: { id: input.itemId, receiptId: input.receiptId },
    select: {
      id: true,
      qtdPedida: true,
      qtdFaturada: true,
      receipt: { select: { status: true } },
    },
  });
  if (!linha) throw new Error("Item não encontrado neste recebimento.");
  if (linha.receipt?.status === "FINALIZADO" || linha.receipt?.status === "CANCELADO") {
    throw new Error("Este recebimento está encerrado.");
  }

  // Contar diferente do esperado é uma DECISÃO do operador, e ela precisa
  // sobreviver ao recarregamento da tela: sem isto o fechamento voltaria a
  // pedir justificativa de algo que já foi resolvido na linha.
  const esperado = esperadoDaLinha(linha);
  const mexeuNaQtd = input.qtdRecebida !== undefined;
  const qtd = input.qtdRecebida == null ? null : Math.max(0, input.qtdRecebida);
  const ajustou = qtd != null && Math.abs(qtd - esperado) > TOL_QTD;

  await db.purchaseReconciliationItem.update({
    where: { id: linha.id },
    data: {
      ...(mexeuNaQtd ? { qtdRecebida: qtd } : {}),
      resolucao: mexeuNaQtd && ajustou ? "AJUSTADO" : undefined,
      ...(input.custoUnitario != null ? { custoFaturado: input.custoUnitario } : {}),
      ...(input.lote !== undefined ? { lote: input.lote?.trim() || null } : {}),
      ...(input.validade !== undefined
        ? { validade: input.validade ? new Date(`${input.validade}T00:00:00`) : null }
        : {}),
      ...(input.motivoDivergencia !== undefined
        ? { motivoDivergencia: input.motivoDivergencia?.trim() || null }
        : {}),
    },
  });

  await marcarEmConferencia(input.receiptId);
}

// ── Atalho: conferir e fechar num passo só ──────────────────

/** Contagem de uma linha, na chave que a tela do pedido conhece. */
export type ContagemDoPedido = {
  /** Id do PurchaseOrderItem — um pedido pode ter duas linhas do mesmo produto. */
  itemId: string;
  qtdRecebida: number;
  validade?: string | null;
  lote?: string | null;
  /** Custo REAL por unidade de compra, quando chegou por outro preço. */
  custoUnitario?: number | null;
  motivoDivergencia?: string | null;
};

/** Mercadoria conferida que não estava no pedido. */
export type ExtraDoPedido = {
  productId: string;
  packagingId?: string | null;
  quantidade: number;
  custoUnitario: number;
  validade?: string | null;
  lote?: string | null;
  motivo: string;
};

/**
 * Abre, conta e fecha o recebimento de um pedido de uma vez.
 *
 * É o caminho de quem confere na porta com o pedido impresso na mão (e o do
 * celular, em /m/receber): a conferência inteira acontece num formulário só, e
 * o recebimento existe do mesmo jeito por trás — com número, status e história.
 * Sem isto, o atalho geraria estoque sem recebimento e a tela de Recebimentos
 * mostraria menos do que aconteceu.
 */
export async function receberPedidoDeUmaVez(
  tenantId: string,
  purchaseOrderId: string,
  contagem: ContagemDoPedido[],
  opts: {
    numeroNota?: string | null;
    gerarFinanceiro?: boolean;
    createdBy?: string;
    extras?: ExtraDoPedido[];
    motivoDivergencia?: string | null;
  },
): Promise<ResultadoRecebimento> {
  const receipt = await iniciarRecebimentoDoPedido({
    tenantId,
    purchaseOrderId,
    userId: opts.createdBy ?? null,
  });

  if (opts.numeroNota?.trim()) {
    await db.goodsReceipt.update({
      where: { id: receipt.id },
      data: { numeroNota: opts.numeroNota.trim() },
    });
  }

  const linhas = await db.purchaseReconciliationItem.findMany({
    where: { receiptId: receipt.id },
    select: { id: true, purchaseOrderItemId: true, qtdPedida: true },
  });
  const porItemDoPedido = new Map(
    linhas
      .filter((l) => l.purchaseOrderItemId)
      .map((l) => [l.purchaseOrderItemId as string, l]),
  );
  const fatores = await fatoresDoPedido(purchaseOrderId);

  // Linha do pedido não citada na contagem não veio neste caminhão: zera, em
  // vez de entrar pelo esperado. Quem não contou não recebeu.
  const contadas = new Set<string>();
  for (const c of contagem) {
    const linha = porItemDoPedido.get(c.itemId);
    if (!linha) continue;
    contadas.add(linha.id);
    const fator = fatores.get(c.itemId) ?? 1;
    await db.purchaseReconciliationItem.update({
      where: { id: linha.id },
      data: {
        qtdRecebida: Math.max(0, c.qtdRecebida) * fator,
        ...(c.custoUnitario != null && c.custoUnitario >= 0
          ? { custoFaturado: fator > 0 ? c.custoUnitario / fator : c.custoUnitario }
          : {}),
        lote: c.lote?.trim() || null,
        validade: c.validade ? new Date(`${c.validade}T00:00:00`) : null,
        motivoDivergencia: c.motivoDivergencia?.trim() || null,
      },
    });
  }
  for (const l of linhas) {
    if (contadas.has(l.id)) continue;
    await db.purchaseReconciliationItem.update({
      where: { id: l.id },
      data: { qtdRecebida: 0 },
    });
  }

  for (const e of (opts.extras ?? []).filter((e) => e.quantidade > 0)) {
    const fator = e.packagingId ? ((await fatoresDe([e.packagingId])).get(e.packagingId) ?? 1) : 1;
    await adicionarItemAoRecebimento({
      tenantId,
      receiptId: receipt.id,
      productId: e.productId,
      quantidade: e.quantidade * fator,
      custoUnitario: fator > 0 ? e.custoUnitario / fator : e.custoUnitario,
      lote: e.lote,
      validade: e.validade,
      motivo: `Fora do pedido: ${e.motivo}`,
    });
  }

  return finalizarRecebimento({
    tenantId,
    receiptId: receipt.id,
    // Receber parcial é rotina, não incidente: o motivo declarado da carga
    // cobre as linhas que vieram a menos.
    motivoDivergencia:
      opts.motivoDivergencia?.trim() ||
      contagem.find((c) => c.motivoDivergencia?.trim())?.motivoDivergencia?.trim() ||
      "Conferência na porta: recebido o que chegou neste caminhão.",
    gerarFinanceiro: opts.gerarFinanceiro,
    userId: opts.createdBy ?? null,
  });
}

/** Fator de conversão de cada linha do pedido (caixa → unidade base). */
async function fatoresDoPedido(purchaseOrderId: string): Promise<Map<string, number>> {
  const itens = await db.purchaseOrderItem.findMany({
    where: { purchaseOrderId },
    select: { id: true, packagingId: true },
  });
  const pacotes = await fatoresDe(itens.map((i) => i.packagingId));
  return new Map(
    itens.map((i) => [i.id, (i.packagingId ? pacotes.get(i.packagingId) : null) ?? 1]),
  );
}

const fmtNum = (v: number) =>
  Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
