import "server-only";
import { db } from "@/lib/prisma";
import type { AccountPayableStatus } from "@/generated/prisma";

// ============================================================
// Contas a pagar ao fornecedor.
//
// A mercadoria que entra tem duas consequências: o saldo sobe (estoque) e a
// dívida nasce (aqui). Até agora só a primeira existia — as duplicatas da NF-e
// ficavam guardadas em `FiscalInboundDuplicata` como informação morta.
//
// Regra: cada duplicata da nota vira UM título. Nota sem duplicata (venda à
// vista, ou fornecedor que não preenche `cobr`) vira parcela única, com
// vencimento derivado do prazo negociado do fornecedor — e quando nem isso
// existe, vence na data da entrada.
//
// Idempotente por (inboundId): reprocessar uma nota não duplica dívida.
// ============================================================

/** Vencimento da parcela única quando a nota não traz duplicata. */
function vencimentoPadrao(base: Date, prazoDias: number | null | undefined): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + (prazoDias && prazoDias > 0 ? prazoDias : 0));
  return d;
}

export type ResumoTitulos = {
  criados: number;
  valorTotal: number;
  /** true quando não havia duplicata e o vencimento foi derivado do prazo. */
  estimado: boolean;
};

/**
 * Emite os títulos de uma nota de entrada. Chamado logo depois de a nota gerar
 * estoque — os dois lados do mesmo fato nascem juntos.
 */
export async function gerarTitulosDaNota(input: {
  tenantId: string;
  inboundId: string;
  purchaseId?: string | null;
  userId?: string | null;
}): Promise<ResumoTitulos> {
  const { tenantId, inboundId, purchaseId, userId } = input;

  const jaTem = await db.accountPayable.findFirst({
    where: { inboundId },
    select: { id: true },
  });
  if (jaTem) return { criados: 0, valorTotal: 0, estimado: false };

  const nota = await db.fiscalInbound.findFirst({
    where: { id: inboundId },
    select: {
      id: true,
      numero: true,
      serie: true,
      dataEmissao: true,
      valorTotal: true,
      supplierId: true,
      purchaseOrderId: true,
      purchaseId: true,
      emitRazaoSocial: true,
      duplicatas: { select: { numero: true, vencimento: true, valor: true }, orderBy: { vencimento: "asc" } },
      supplier: { select: { prazoPagamentoDias: true } },
    },
  });
  if (!nota) throw new Error("Nota não encontrada.");

  const documento = `${nota.numero}/${nota.serie}`;
  const descricao = `NF-e ${documento} — ${nota.emitRazaoSocial}`;
  const comum = {
    tenantId,
    supplierId: nota.supplierId,
    purchaseId: purchaseId ?? nota.purchaseId,
    purchaseOrderId: nota.purchaseOrderId,
    inboundId: nota.id,
    numeroDocumento: documento,
    descricao,
    createdBy: userId ?? null,
  };

  const parcelas = nota.duplicatas.length
    ? nota.duplicatas.map((d) => ({
        parcela: d.numero,
        vencimento: d.vencimento,
        valor: Number(d.valor),
      }))
    : [
        {
          parcela: null,
          vencimento: vencimentoPadrao(nota.dataEmissao, nota.supplier?.prazoPagamentoDias),
          valor: Number(nota.valorTotal),
        },
      ];

  await db.accountPayable.createMany({
    data: parcelas.map((p) => ({ ...comum, ...p })),
  });

  // O pedido passa a saber que o financeiro já saiu — evita emitir de novo se
  // a nota for reconciliada com outro pedido depois.
  if (nota.purchaseOrderId) {
    await db.purchaseOrder.updateMany({
      where: { id: nota.purchaseOrderId },
      data: { financeiroGerado: true },
    });
  }

  return {
    criados: parcelas.length,
    valorTotal: parcelas.reduce((a, p) => a + p.valor, 0),
    estimado: nota.duplicatas.length === 0,
  };
}

/**
 * Título de uma entrada lançada à mão. Sem nota não há duplicata, então é
 * sempre parcela única — e nasce marcada como estimativa na observação, para
 * o financeiro saber que aquele vencimento é do prazo do fornecedor, não de um
 * boleto real.
 */
export async function gerarTituloDaEntradaManual(input: {
  tenantId: string;
  purchaseId: string;
  supplierId: string | null;
  purchaseOrderId?: string | null;
  valor: number;
  numeroNota?: string | null;
  data: Date;
  /** Vencimento informado na conferência. Sem ele, vale o prazo do fornecedor. */
  vencimento?: Date | null;
  userId?: string | null;
}): Promise<ResumoTitulos> {
  const { tenantId, purchaseId, supplierId, valor } = input;
  if (valor <= 0 || !supplierId) return { criados: 0, valorTotal: 0, estimado: false };

  const jaTem = await db.accountPayable.findFirst({ where: { purchaseId }, select: { id: true } });
  if (jaTem) return { criados: 0, valorTotal: 0, estimado: false };

  const fornecedor = await db.supplier.findFirst({
    where: { id: supplierId },
    select: { razaoSocial: true, nomeFantasia: true, prazoPagamentoDias: true },
  });
  const nome = fornecedor?.nomeFantasia || fornecedor?.razaoSocial || "Fornecedor";

  await db.accountPayable.create({
    data: {
      tenantId,
      supplierId,
      purchaseId,
      purchaseOrderId: input.purchaseOrderId ?? null,
      numeroDocumento: input.numeroNota ?? null,
      descricao: `Entrada manual — ${nome}`,
      vencimento: input.vencimento ?? vencimentoPadrao(input.data, fornecedor?.prazoPagamentoDias),
      valor,
      observacao: input.vencimento
        ? null
        : "Vencimento estimado pelo prazo do fornecedor — confira ao receber o boleto.",
      createdBy: input.userId ?? null,
    },
  });

  return { criados: 1, valorTotal: valor, estimado: !input.vencimento };
}

/**
 * Baixa de um título. Pagamento parcial mantém ABERTO com `valorPago` maior.
 *
 * Grava uma linha em `AccountPayablePayment` com autor e data: `valorPago` é
 * saldo cacheado, e saldo não responde "quem deu baixa nisso?" — a pergunta que
 * só aparece no dia em que o boleto foi pago duas vezes.
 */
export async function pagarTitulo(input: {
  tenantId: string;
  tituloId: string;
  valorPago?: number | null;
  pagoEm?: Date | null;
  observacao?: string | null;
  userId?: string | null;
}): Promise<{ valor: number; quitado: boolean }> {
  const titulo = await db.accountPayable.findFirst({
    where: { id: input.tituloId },
    select: { valor: true, valorPago: true, status: true },
  });
  if (!titulo) throw new Error("Título não encontrado.");
  if (titulo.status === "CANCELADO") throw new Error("Este título foi cancelado.");
  if (titulo.status === "PAGO") throw new Error("Este título já está quitado.");

  const devido = Number(titulo.valor) - Number(titulo.valorPago);
  if (devido <= 0.005) throw new Error("Este título não tem saldo a pagar.");

  const valor = input.valorPago ?? devido;
  if (valor <= 0) throw new Error("Informe o valor pago.");
  if (valor > devido + 0.005) {
    throw new Error(
      `O valor informado passa do saldo do título (${devido.toFixed(2)}). Pagamento a maior vira crédito, não baixa.`,
    );
  }

  const pagoEm = input.pagoEm ?? new Date();
  const acumulado = Number(titulo.valorPago) + valor;
  const quitado = acumulado >= Number(titulo.valor) - 0.005;

  await db.accountPayablePayment.create({
    data: {
      tenantId: input.tenantId,
      payableId: input.tituloId,
      origem: "PAGAMENTO",
      valor,
      pagoEm,
      observacao: input.observacao ?? null,
      createdBy: input.userId ?? null,
    },
  });

  await db.accountPayable.update({
    where: { id: input.tituloId },
    data: {
      valorPago: acumulado,
      status: quitado ? "PAGO" : "ABERTO",
      pagoEm: quitado ? pagoEm : null,
    },
  });

  return { valor, quitado };
}

/** Cancela um título (nota devolvida inteira, cobrança indevida). */
export async function cancelarTitulo(input: { tituloId: string; motivo: string }): Promise<void> {
  const titulo = await db.accountPayable.findFirst({
    where: { id: input.tituloId },
    select: { status: true },
  });
  if (!titulo) throw new Error("Título não encontrado.");
  if (titulo.status === "PAGO") {
    throw new Error("Título já pago. Para reverter, registre um crédito de devolução.");
  }
  await db.accountPayable.update({
    where: { id: input.tituloId },
    data: { status: "CANCELADO", observacao: input.motivo },
  });
}

/**
 * Devolução ao fornecedor abate o que se deve. Vai abatendo dos títulos em
 * aberto mais próximos do vencimento até o crédito acabar — o que sobra fica
 * registrado na observação do último título tocado, porque crédito a favor da
 * loja é assunto de negociação, não de saldo automático.
 */
export async function creditarDevolucao(input: {
  tenantId: string;
  supplierId: string;
  valor: number;
  referencia: string;
  returnId?: string | null;
  userId?: string | null;
}): Promise<{ abatido: number; sobra: number; titulos: number }> {
  if (input.valor <= 0) return { abatido: 0, sobra: 0, titulos: 0 };

  const abertos = await db.accountPayable.findMany({
    where: { supplierId: input.supplierId, status: "ABERTO" },
    select: { id: true, valor: true, valorPago: true, observacao: true },
    orderBy: { vencimento: "asc" },
  });

  let restante = input.valor;
  let tocados = 0;

  for (const t of abertos) {
    if (restante <= 0) break;
    const devido = Number(t.valor) - Number(t.valorPago);
    if (devido <= 0) continue;

    const abate = Math.min(devido, restante);
    const acumulado = Number(t.valorPago) + abate;
    const quitado = acumulado >= Number(t.valor) - 0.005;
    const agora = new Date();

    // Crédito de devolução entra no extrato como baixa, mas com origem própria:
    // no caixa isso NÃO é dinheiro que saiu, e somar os dois mentiria o fluxo.
    await db.accountPayablePayment.create({
      data: {
        tenantId: input.tenantId,
        payableId: t.id,
        origem: "CREDITO_DEVOLUCAO",
        valor: abate,
        pagoEm: agora,
        returnId: input.returnId ?? null,
        observacao: `Crédito da devolução ${input.referencia}`,
        createdBy: input.userId ?? null,
      },
    });

    await db.accountPayable.update({
      where: { id: t.id },
      data: {
        valorPago: acumulado,
        status: quitado ? "PAGO" : "ABERTO",
        pagoEm: quitado ? agora : null,
        observacao: [t.observacao, `Crédito de devolução ${input.referencia}`]
          .filter(Boolean)
          .join(" · "),
      },
    });

    restante -= abate;
    tocados += 1;
  }

  return { abatido: input.valor - restante, sobra: restante, titulos: tocados };
}

// ── Leitura ───────────────────────────────────────────────────

export type FiltroTitulos = {
  status?: AccountPayableStatus | "VENCIDO" | null;
  supplierId?: string | null;
  de?: Date | null;
  ate?: Date | null;
};

export function whereTitulos(f: FiltroTitulos) {
  const where: Record<string, unknown> = {};
  if (f.supplierId) where.supplierId = f.supplierId;
  if (f.status === "VENCIDO") {
    where.status = "ABERTO";
    where.vencimento = { lt: new Date() };
  } else if (f.status) {
    where.status = f.status;
  }
  if (f.de || f.ate) {
    where.vencimento = {
      ...(typeof where.vencimento === "object" && where.vencimento !== null ? where.vencimento : {}),
      ...(f.de ? { gte: f.de } : {}),
      ...(f.ate ? { lte: f.ate } : {}),
    };
  }
  return where;
}
