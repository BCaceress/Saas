import "server-only";
import { db, basePrisma, comTenant } from "@/lib/prisma";
import { proximoNumeroPedido } from "@/lib/estoque";
import { registrarEvento } from "@/lib/compras/eventos";
import { resolverVariacoesDosItens } from "@/lib/variacoes";
import type { PurchaseOrderOrigem } from "@/generated/prisma";

// ============================================================
// Documento de Compra — a espinha de tudo que entra na loja.
//
// Havia cinco portas de entrada e só duas deixavam rastro de pedido. XML sem
// pedido já criava um retroativo; NF-e capturada no DFe e lançamento manual
// não criavam nada — a mercadoria aparecia no saldo sem documento por trás.
//
// Aqui o pedido deixa de ser "o que eu planejei comprar" e passa a ser "o
// documento daquilo que entrou". Quando houve planejamento, ele nasce antes;
// quando não houve, nasce retroativo, marcado com a origem real. A pergunta
// "de onde veio esta mercadoria?" passa a ter resposta sempre.
//
// O outro lado do mesmo problema mora aqui também: uma entrada lançada à mão
// fica marcada como `aguardandoDocumento`, e quando o XML chega (upload, IMAP
// ou SEFAZ) ele é oferecido para VINCULAR em vez de gerar estoque de novo.
// ============================================================

export type ItemRetroativo = {
  productId: string;
  /** Variação comercial (sabor/cor) que entrou nesta linha, quando houver. */
  variantId?: string | null;
  packagingId?: string | null;
  /** Quantidade na unidade de COMPRA (o fator do pacote é do cadastro). */
  quantidade: number;
  custoUnitario: number;
  bonificacao?: boolean;
};

/**
 * Cria o pedido que documenta uma entrada que não teve pedido. Nasce já
 * RECEBIDO — não existe "aguardando" para algo que já está na prateleira.
 */
export async function criarPedidoRetroativo(input: {
  tenantId: string;
  siteId: string;
  supplierId: string;
  origem: PurchaseOrderOrigem;
  itens: ItemRetroativo[];
  dataDocumento?: Date | null;
  observacao?: string | null;
  userId?: string | null;
}): Promise<{ id: string; numero: string }> {
  const { tenantId, siteId, supplierId, origem, itens } = input;
  const validos = itens.filter((i) => i.productId && i.quantidade > 0);
  if (validos.length === 0) {
    throw new Error("Não há itens com produto para documentar esta entrada.");
  }

  const numero = await proximoNumeroPedido(tenantId);
  const variacoes = await resolverVariacoesDosItens(tenantId, validos);
  const recebidoEm = input.dataDocumento ?? new Date();
  const valorTotal = validos.reduce(
    (a, i) => a + (i.bonificacao ? 0 : i.quantidade * i.custoUnitario),
    0,
  );

  const po = await basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`;
    return tx.purchaseOrder.create({
      data: {
        tenantId,
        siteId,
        supplierId,
        numero,
        origem,
        status: "RECEBIDO",
        // Um retroativo nunca teve saldo em aberto: o que chegou é tudo o que
        // foi "pedido". Marcar ENCERRADO evita que ele apareça na fila de
        // pendências de saldo junto com pedidos de verdade.
        saldoResolucao: "ENCERRADO",
        saldoResolvidoEm: recebidoEm,
        saldoMotivo: "Pedido criado a partir da entrada — não houve saldo.",
        recebidoEm,
        enviadoEm: recebidoEm,
        confirmadoEm: recebidoEm,
        valorTotal,
        observacao: input.observacao ?? null,
        createdBy: input.userId ?? null,
        items: {
          create: validos.map((i) => ({
            tenantId,
            productId: i.productId,
            packagingId: i.packagingId ?? null,
            variantId: variacoes.get(i.variantId ?? "")?.variantId ?? null,
            variacaoNome: variacoes.get(i.variantId ?? "")?.variacaoNome ?? null,
            tipo: i.bonificacao ? "BONIFICACAO" : "COMPRA",
            motivoBonificacao: i.bonificacao ? "COMERCIAL" : null,
            qtdPedida: i.quantidade,
            qtdRecebida: i.quantidade,
            custoUnitario: i.bonificacao ? 0 : i.custoUnitario,
          })),
        },
      },
      select: { id: true, numero: true },
    });
  });

  await registrarEvento({
    tenantId,
    purchaseOrderId: po.id,
    tipo: "PEDIDO_CRIADO",
    descricao: `Pedido ${numero} criado a partir da entrada (${rotuloOrigem(origem)}).`,
    createdBy: input.userId,
  });

  return po;
}

export function rotuloOrigem(o: PurchaseOrderOrigem): string {
  switch (o) {
    case "COTACAO": return "cotação";
    case "REPOSICAO": return "reposição";
    case "CARRINHO": return "comparador";
    case "XML": return "XML importado";
    case "DFE": return "NF-e capturada na SEFAZ";
    case "ENTRADA_MANUAL": return "lançamento manual";
    default: return "pedido direto";
  }
}

/**
 * Garante que a nota tenha um pedido por trás. Chamado antes de gerar estoque:
 * a nota que veio do DFe (ninguém pediu, o fornecedor mandou) sai daqui com o
 * mesmo documento que a nota conciliada tem.
 */
export async function garantirPedidoDaNota(input: {
  tenantId: string;
  inboundId: string;
  origem: PurchaseOrderOrigem;
  userId?: string | null;
}): Promise<string | null> {
  const nota = await db.fiscalInbound.findFirst({
    where: { id: input.inboundId },
    select: {
      id: true,
      siteId: true,
      supplierId: true,
      purchaseOrderId: true,
      numero: true,
      serie: true,
      dataEmissao: true,
      emitRazaoSocial: true,
      items: {
        select: {
          productId: true,
          variantId: true,
          packagingId: true,
          quantidade: true,
          fatorConversao: true,
          valorTotal: true,
          bonificacao: true,
        },
      },
    },
  });
  if (!nota) throw new Error("Nota não encontrada.");
  if (nota.purchaseOrderId) return nota.purchaseOrderId;
  if (!nota.supplierId) return null;

  const itens: ItemRetroativo[] = nota.items
    .filter((i) => i.productId)
    .map((i) => {
      // O pedido guarda a unidade de COMPRA (o que o fornecedor cobra), não a
      // unidade base — é assim que o pedido feito à mão registra, e misturar as
      // duas faria a conferência comparar caixa com garrafa.
      const qtd = Number(i.quantidade);
      return {
        productId: i.productId as string,
        variantId: i.variantId,
        packagingId: i.packagingId,
        quantidade: qtd,
        custoUnitario: qtd > 0 ? Number(i.valorTotal) / qtd : 0,
        bonificacao: i.bonificacao,
      };
    });

  if (itens.length === 0) return null;

  const po = await criarPedidoRetroativo({
    tenantId: input.tenantId,
    siteId: nota.siteId,
    supplierId: nota.supplierId,
    origem: input.origem,
    itens,
    dataDocumento: nota.dataEmissao,
    observacao: `Gerado pela NF-e ${nota.numero}/${nota.serie} — ${nota.emitRazaoSocial}`,
    userId: input.userId,
  });

  await db.fiscalInbound.update({
    where: { id: nota.id },
    data: { purchaseOrderId: po.id, conciliadoEm: new Date(), vinculoAutomatico: true },
  });

  await registrarEvento({
    tenantId: input.tenantId,
    purchaseOrderId: po.id,
    inboundId: nota.id,
    tipo: "XML_RECEBIDO",
    descricao: `NF-e ${nota.numero}/${nota.serie} originou este pedido.`,
    createdBy: input.userId,
  });

  return po.id;
}

// ── Entrada manual × XML que chega depois ─────────────────────

export type CandidatoEntradaManual = {
  purchaseId: string;
  data: Date;
  numeroNota: string | null;
  observacao: string | null;
  valorTotal: number;
  itens: number;
  score: number;
  motivos: string[];
};

/**
 * Entradas lançadas à mão que esta nota PODE estar documentando.
 *
 * O sinal forte é o trio fornecedor + data próxima + valor próximo. Produto em
 * comum entra como confirmação, não como requisito: quem lança à mão costuma
 * lançar só o que interessa, e exigir cobertura total descartaria justamente o
 * caso que mais duplica estoque.
 */
export async function entradasAguardandoDocumento(input: {
  supplierId: string | null;
  siteId: string;
  dataEmissao: Date;
  valorTotal: number;
  produtoIds: string[];
}): Promise<CandidatoEntradaManual[]> {
  if (!input.supplierId) return [];

  const janela = 15 * 24 * 60 * 60 * 1000;
  const candidatas = await db.purchase.findMany({
    where: {
      supplierId: input.supplierId,
      aguardandoDocumento: true,
      chaveNfe: null,
      data: {
        gte: new Date(input.dataEmissao.getTime() - janela),
        lte: new Date(input.dataEmissao.getTime() + janela),
      },
    },
    select: {
      id: true,
      data: true,
      numeroNota: true,
      observacao: true,
      items: { select: { productId: true, custoTotal: true } },
    },
    orderBy: { data: "desc" },
    take: 20,
  });

  const alvo = new Set(input.produtoIds);

  return candidatas
    .map((c): CandidatoEntradaManual => {
      const valorTotal = c.items.reduce((a, i) => a + Number(i.custoTotal), 0);
      const dias = Math.abs(c.data.getTime() - input.dataEmissao.getTime()) / 86_400_000;
      const motivos: string[] = ["Mesmo fornecedor"];
      let score = 40;

      if (dias <= 1) { score += 25; motivos.push("Lançada no mesmo dia da emissão"); }
      else if (dias <= 3) { score += 18; motivos.push(`Lançada ${Math.round(dias)} dia(s) depois`); }
      else if (dias <= 7) { score += 10; motivos.push(`Lançada na mesma semana`); }

      if (input.valorTotal > 0 && valorTotal > 0) {
        const desvio = Math.abs(valorTotal - input.valorTotal) / input.valorTotal;
        if (desvio <= 0.02) { score += 30; motivos.push("Valor praticamente igual ao da nota"); }
        else if (desvio <= 0.1) { score += 15; motivos.push("Valor próximo ao da nota"); }
      }

      const comuns = c.items.filter((i) => alvo.has(i.productId)).length;
      if (comuns > 0) {
        score += Math.min(20, comuns * 5);
        motivos.push(`${comuns} produto(s) em comum com a nota`);
      }

      return {
        purchaseId: c.id,
        data: c.data,
        numeroNota: c.numeroNota,
        observacao: c.observacao,
        valorTotal,
        itens: c.items.length,
        score: Math.min(100, score),
        motivos,
      };
    })
    .filter((c) => c.score >= 55)
    .sort((a, b) => b.score - a.score);
}

/**
 * A nota documenta uma entrada que já existe. NÃO movimenta estoque — é este o
 * ponto: sem isto o operador receberia a nota e a mercadoria entraria de novo.
 */
export async function vincularNotaAEntradaManual(input: {
  tenantId: string;
  inboundId: string;
  purchaseId: string;
  userId?: string | null;
}): Promise<void> {
  const { tenantId, inboundId, purchaseId, userId } = input;

  const nota = await db.fiscalInbound.findFirst({
    where: { id: inboundId },
    select: {
      id: true,
      status: true,
      chave: true,
      numero: true,
      serie: true,
      supplierId: true,
      purchaseOrderId: true,
      emitRazaoSocial: true,
    },
  });
  if (!nota) throw new Error("Nota não encontrada.");
  if (nota.status === "RECEBIDO") {
    throw new Error("Esta nota já gerou entrada de estoque.");
  }

  const entrada = await db.purchase.findFirst({
    where: { id: purchaseId },
    select: { id: true, chaveNfe: true, purchaseOrderId: true, aguardandoDocumento: true },
  });
  if (!entrada) throw new Error("Entrada não encontrada.");
  if (entrada.chaveNfe) {
    throw new Error("Esta entrada já foi documentada por outra nota.");
  }

  await db.purchase.update({
    where: { id: purchaseId },
    data: {
      aguardandoDocumento: false,
      chaveNfe: nota.chave,
      documentoVinculadoEm: new Date(),
      numeroNota: `${nota.numero}/${nota.serie}`,
    },
  });

  await db.fiscalInbound.update({
    where: { id: inboundId },
    data: {
      status: "VINCULADO",
      purchaseId,
      purchaseOrderId: nota.purchaseOrderId ?? entrada.purchaseOrderId,
      semEstoqueMotivo:
        "Documenta uma entrada já lançada à mão — o estoque não foi movimentado de novo.",
      conciliadoEm: new Date(),
    },
  });

  const pedidoId = nota.purchaseOrderId ?? entrada.purchaseOrderId;
  if (pedidoId) {
    await registrarEvento({
      tenantId,
      purchaseOrderId: pedidoId,
      inboundId,
      tipo: "DOCUMENTO_VINCULADO",
      descricao: `NF-e ${nota.numero}/${nota.serie} documentou a entrada lançada à mão — estoque não movimentado de novo.`,
      createdBy: userId,
    });
  }
}

/** Quantas entradas manuais ainda esperam documento — vira alerta na tela. */
export async function contarAguardandoDocumento(tenantId: string): Promise<number> {
  return comTenant(
    tenantId,
    basePrisma.purchase.count({ where: { tenantId, aguardandoDocumento: true, chaveNfe: null } }),
  );
}
