import "server-only";
import { db } from "@/lib/prisma";
import { proximoNumeroDocumento } from "@/lib/numeracao";
import { registrarDevolucao } from "@/lib/estoque";
import { registrarEvento } from "@/lib/compras/eventos";
import { creditarDevolucao } from "@/lib/financeiro/contas-pagar";
import type { SupplierReturnMotivo } from "@/generated/prisma";

// ============================================================
// Devolução ao fornecedor — o inverso do recebimento.
//
// O formulário existia (`estoque/devolucoes/_client.tsx`) mas sem página que o
// montasse e sem documento por trás: mexia no saldo e sumia. Sem documento,
// três perguntas ficavam sem resposta — que nota trouxe a mercadoria, quanto
// disso o fornecedor ainda vai nos cobrar, e o que exatamente voltou.
//
// Ciclo: RASCUNHO (monta, confere, imprime) → CONFIRMADA (sai do estoque e
// abate o que se deve). Só CONFIRMADA movimenta — devolução é conversa com o
// fornecedor, e quase nunca sai pronta de primeira.
// ============================================================

async function proximoNumeroDevolucao(tenantId: string): Promise<string> {
  return proximoNumeroDocumento(tenantId, "DEV");
}

export type ItemDevolucao = {
  productId: string;
  /** Sempre em unidade BASE — a devolução sai do saldo, não do pacote. */
  quantidade: number;
  custoUnitario?: number | null;
  observacao?: string | null;
};

export async function criarDevolucaoFornecedor(input: {
  tenantId: string;
  siteId: string;
  supplierId: string;
  motivo: SupplierReturnMotivo;
  observacao: string;
  itens: ItemDevolucao[];
  purchaseId?: string | null;
  purchaseOrderId?: string | null;
  inboundId?: string | null;
  numeroNota?: string | null;
  chaveNfe?: string | null;
  confirmar?: boolean;
  userId?: string | null;
}): Promise<{ id: string; numero: string }> {
  const validos = input.itens.filter((i) => i.productId && i.quantidade > 0);
  if (validos.length === 0) throw new Error("Adicione ao menos um item à devolução.");
  if (!input.observacao.trim()) throw new Error("Descreva o motivo da devolução.");

  // Custo: o do item quando informado, senão o custo médio do produto. Sem
  // isso a devolução sairia por zero e o crédito com o fornecedor não fecharia.
  const custos = await custoMedioDe(validos.map((i) => i.productId));

  const numero = await proximoNumeroDevolucao(input.tenantId);
  const itensComCusto = validos.map((i) => ({
    ...i,
    custoUnitario: i.custoUnitario ?? custos.get(i.productId) ?? 0,
  }));
  const valorTotal = itensComCusto.reduce((a, i) => a + i.quantidade * i.custoUnitario, 0);

  const dev = await db.supplierReturn.create({
    data: {
      tenantId: input.tenantId,
      siteId: input.siteId,
      supplierId: input.supplierId,
      numero,
      motivo: input.motivo,
      observacao: input.observacao.trim(),
      purchaseId: input.purchaseId ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null,
      inboundId: input.inboundId ?? null,
      numeroNota: input.numeroNota ?? null,
      chaveNfe: input.chaveNfe ?? null,
      valorTotal,
      createdBy: input.userId ?? null,
      items: {
        create: itensComCusto.map((i) => ({
          tenantId: input.tenantId,
          productId: i.productId,
          quantidade: i.quantidade,
          custoUnitario: i.custoUnitario,
          observacao: i.observacao ?? null,
        })),
      },
    },
    select: { id: true, numero: true },
  });

  if (input.confirmar) {
    await confirmarDevolucao({ tenantId: input.tenantId, returnId: dev.id, userId: input.userId });
  }

  return dev;
}

/**
 * Tira do estoque e abate o que se deve. Confere saldo antes: devolver mais do
 * que existe deixaria o estoque negativo e o fornecedor com crédito inventado.
 */
export async function confirmarDevolucao(input: {
  tenantId: string;
  returnId: string;
  userId?: string | null;
}): Promise<{ abatido: number; sobra: number }> {
  const dev = await db.supplierReturn.findFirst({
    where: { id: input.returnId },
    select: {
      id: true,
      numero: true,
      status: true,
      siteId: true,
      supplierId: true,
      purchaseId: true,
      purchaseOrderId: true,
      inboundId: true,
      observacao: true,
      valorTotal: true,
      items: { select: { productId: true, quantidade: true, custoUnitario: true } },
    },
  });
  if (!dev) throw new Error("Devolução não encontrada.");
  if (dev.status === "CONFIRMADA") throw new Error("Esta devolução já foi confirmada.");
  if (dev.status === "CANCELADA") throw new Error("Esta devolução foi cancelada.");

  const saldos = await db.stock.findMany({
    where: {
      siteId: dev.siteId,
      productId: { in: dev.items.map((i) => i.productId) },
    },
    select: { productId: true, estoqueFechado: true },
  });
  const porProduto = new Map(saldos.map((s) => [s.productId, Number(s.estoqueFechado)]));

  const semSaldo = dev.items.filter(
    (i) => (porProduto.get(i.productId) ?? 0) < Number(i.quantidade),
  );
  if (semSaldo.length > 0) {
    const nomes = await db.product.findMany({
      where: { id: { in: semSaldo.map((i) => i.productId) } },
      select: { id: true, nome: true },
    });
    throw new Error(
      `Saldo insuficiente para devolver: ${nomes.map((n) => n.nome).join(", ")}. Confira o estoque antes de confirmar.`,
    );
  }

  for (const item of dev.items) {
    await registrarDevolucao(
      input.tenantId,
      dev.siteId,
      item.productId,
      "FORNECEDOR",
      { fechado: Number(item.quantidade) },
      `Devolução ${dev.numero} — ${dev.observacao}`,
      {
        custoUnitario: Number(item.custoUnitario),
        purchaseId: dev.purchaseId ?? undefined,
        createdBy: input.userId ?? undefined,
      },
    );
  }

  const credito = await creditarDevolucao({
    tenantId: input.tenantId,
    supplierId: dev.supplierId,
    valor: Number(dev.valorTotal),
    referencia: dev.numero,
    returnId: dev.id,
    userId: input.userId,
  });

  await db.supplierReturn.update({
    where: { id: dev.id },
    data: { status: "CONFIRMADA", confirmadaEm: new Date() },
  });

  if (dev.purchaseOrderId) {
    await registrarEvento({
      tenantId: input.tenantId,
      purchaseOrderId: dev.purchaseOrderId,
      inboundId: dev.inboundId,
      tipo: "DEVOLUCAO_REGISTRADA",
      descricao:
        `Devolução ${dev.numero}: ${dev.items.length} item(ns) voltaram ao fornecedor.` +
        (credito.abatido > 0
          ? ` Abatido R$ ${credito.abatido.toFixed(2)} em títulos em aberto.`
          : " Nenhum título em aberto para abater."),
      meta: { returnId: dev.id, abatido: credito.abatido, sobra: credito.sobra },
      createdBy: input.userId,
    });
  }

  return credito;
}

export async function cancelarDevolucao(input: {
  returnId: string;
  motivo: string;
}): Promise<void> {
  const dev = await db.supplierReturn.findFirst({
    where: { id: input.returnId },
    select: { status: true, observacao: true },
  });
  if (!dev) throw new Error("Devolução não encontrada.");
  if (dev.status === "CONFIRMADA") {
    throw new Error(
      "Esta devolução já saiu do estoque. Para desfazer, registre uma entrada de ajuste.",
    );
  }
  await db.supplierReturn.update({
    where: { id: input.returnId },
    data: {
      status: "CANCELADA",
      canceladaEm: new Date(),
      observacao: `${dev.observacao} · Cancelada: ${input.motivo}`,
    },
  });
}

/**
 * O que aquela entrada trouxe — a lista que o operador marca para devolver.
 * Sem isto ele digitaria produto por produto e o vínculo com a nota se perderia.
 */
export async function itensDaEntrada(purchaseId: string) {
  const entrada = await db.purchase.findFirst({
    where: { id: purchaseId },
    select: {
      id: true,
      siteId: true,
      supplierId: true,
      numeroNota: true,
      chaveNfe: true,
      purchaseOrderId: true,
      data: true,
      items: { select: { productId: true, quantidade: true, custoTotal: true, packagingId: true } },
    },
  });
  if (!entrada) return null;

  const produtos = await db.product.findMany({
    where: { id: { in: entrada.items.map((i) => i.productId) } },
    select: { id: true, nome: true, sku: true, unidadeBase: true },
  });
  const porId = new Map(produtos.map((p) => [p.id, p]));

  const pacotes = await db.productPackaging.findMany({
    where: {
      id: { in: entrada.items.map((i) => i.packagingId).filter((i): i is string => Boolean(i)) },
    },
    select: { id: true, fatorConversao: true },
  });
  const fator = new Map(pacotes.map((p) => [p.id, Number(p.fatorConversao)]));

  return {
    ...entrada,
    items: entrada.items.map((i) => {
      const f = (i.packagingId ? fator.get(i.packagingId) : null) ?? 1;
      const qtdBase = Number(i.quantidade) * f;
      const p = porId.get(i.productId);
      return {
        productId: i.productId,
        nome: p?.nome ?? "Produto removido do catálogo",
        sku: p?.sku ?? null,
        unidadeBase: p?.unidadeBase ?? "UN",
        quantidade: qtdBase,
        custoUnitario: qtdBase > 0 ? Number(i.custoTotal) / qtdBase : 0,
      };
    }),
  };
}

async function custoMedioDe(productIds: string[]): Promise<Map<string, number>> {
  const produtos = await db.product.findMany({
    where: { id: { in: [...new Set(productIds)] } },
    select: { id: true, custoMedio: true },
  });
  return new Map(produtos.map((p) => [p.id, Number(p.custoMedio ?? 0)]));
}
