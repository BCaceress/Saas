import "server-only";
import { db } from "@/lib/prisma";
import { registrarEvento } from "@/lib/compras/eventos";

// ============================================================
// Entrada lançada à mão × XML que chega depois.
//
// A mercadoria chega antes do papel o tempo todo: o entregador deixa a carga,
// o XML do fornecedor cai no e-mail dois dias depois. A entrada fica marcada
// como `aguardandoDocumento`, e quando a nota chega ela é oferecida para
// VINCULAR em vez de gerar estoque de novo — é o que impede a mesma carga de
// entrar duas vezes.
//
// O que MORAVA aqui e não mora mais: o "pedido retroativo". Toda entrada sem
// pedido criava um PurchaseOrder para "ter documento", e /pedidos acabava
// listando compras que ninguém planejou. Hoje quem documenta o que chegou é o
// RECEBIMENTO (`lib/compras/recebimento.ts`), que existe com pedido, com nota,
// com os dois ou com nenhum. Pedido responde "o que eu comprei?"; recebimento
// responde "o que chegou?" — e um não precisa inventar o outro.
// ============================================================

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
    select: {
      id: true,
      chaveNfe: true,
      purchaseOrderId: true,
      receiptId: true,
      aguardandoDocumento: true,
    },
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

  // O XML chegou DEPOIS da mercadoria — cenário obrigatório, não exceção. Ele
  // documenta o recebimento que já existe em vez de abrir outro; é isto que
  // impede a mesma carga de entrar duas vezes.
  if (entrada.receiptId) {
    const jaVinculada = await db.goodsReceipt.findFirst({
      where: { inboundId, id: { not: entrada.receiptId } },
      select: { numero: true },
    });
    if (jaVinculada) {
      throw new Error(`Esta nota já documenta o recebimento ${jaVinculada.numero}.`);
    }
    await db.goodsReceipt.update({
      where: { id: entrada.receiptId },
      data: { inboundId, numeroNota: `${nota.numero}/${nota.serie}` },
    });
  }

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
  if (pedidoId || entrada.receiptId) {
    await registrarEvento({
      tenantId,
      purchaseOrderId: pedidoId,
      inboundId,
      receiptId: entrada.receiptId,
      tipo: "DOCUMENTO_VINCULADO",
      descricao: `NF-e ${nota.numero}/${nota.serie} documentou a entrada lançada à mão — estoque não movimentado de novo.`,
      createdBy: userId,
    });
  }
}
