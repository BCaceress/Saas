import "server-only";
import { db } from "@/lib/prisma";
import { criarPedidoCompra } from "@/lib/estoque";
import { registrarEvento } from "@/lib/compras/eventos";

// ============================================================
// O saldo do pedido que chegou só em parte.
//
// `RECEBIDO_PARCIAL` dizia "chegou menos do que eu pedi" e parava aí. O que
// faltou ficava em aberto para sempre: ninguém sabia se o resto ainda vinha,
// se o fornecedor tinha cortado, ou se alguém já tinha pedido de novo. Pedido
// velho entulhava a fila de recebimento e o giro contava mercadoria que nunca
// chegaria.
//
// São só três desfechos possíveis, e o operador tem de escolher um:
//   MANTER    — o resto vem depois (o pedido segue aberto, é o padrão)
//   ENCERRAR  — o fornecedor cortou; o que faltou não vem
//   REPEDIR   — o saldo vira um pedido novo, encadeado no original
//
// Encerrar e repedir fecham o pedido original. Só o encadeamento
// (`origemPedidoId`) preserva a história: o pedido novo sabe de quem nasceu.
// ============================================================

const TOL = 0.001;

export type LinhaSaldo = {
  itemId: string;
  productId: string;
  packagingId: string | null;
  descricao: string;
  sku: string | null;
  qtdPedida: number;
  qtdRecebida: number;
  saldo: number;
  custoUnitario: number;
};

export type SaldoPedido = {
  pedidoId: string;
  numero: string;
  supplierId: string;
  supplierNome: string;
  siteId: string;
  status: string;
  resolucao: "PENDENTE" | "ENCERRADO" | "REPEDIDO";
  linhas: LinhaSaldo[];
  valorSaldo: number;
};

/** O que falta chegar num pedido. Lista vazia = nada pendente. */
export async function saldoDoPedido(pedidoId: string): Promise<SaldoPedido | null> {
  const pedido = await db.purchaseOrder.findFirst({
    where: { id: pedidoId },
    select: {
      id: true,
      numero: true,
      siteId: true,
      supplierId: true,
      status: true,
      saldoResolucao: true,
      supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      items: {
        select: {
          id: true,
          productId: true,
          packagingId: true,
          qtdPedida: true,
          qtdRecebida: true,
          custoUnitario: true,
          tipo: true,
        },
      },
    },
  });
  if (!pedido) return null;

  const produtos = await db.product.findMany({
    where: { id: { in: pedido.items.map((i) => i.productId) } },
    select: { id: true, nome: true, sku: true },
  });
  const porId = new Map(produtos.map((p) => [p.id, p]));

  const linhas = pedido.items
    .map((i): LinhaSaldo => {
      const pedida = Number(i.qtdPedida);
      const recebida = Number(i.qtdRecebida);
      const p = porId.get(i.productId);
      return {
        itemId: i.id,
        productId: i.productId,
        packagingId: i.packagingId,
        descricao: p?.nome ?? "Produto removido do catálogo",
        sku: p?.sku ?? null,
        qtdPedida: pedida,
        qtdRecebida: recebida,
        saldo: Math.max(0, pedida - recebida),
        custoUnitario: Number(i.custoUnitario),
      };
    })
    .filter((l) => l.saldo > TOL);

  return {
    pedidoId: pedido.id,
    numero: pedido.numero,
    supplierId: pedido.supplierId,
    supplierNome: pedido.supplier.nomeFantasia || pedido.supplier.razaoSocial,
    siteId: pedido.siteId,
    status: pedido.status,
    resolucao: pedido.saldoResolucao,
    linhas,
    valorSaldo: linhas.reduce((a, l) => a + l.saldo * l.custoUnitario, 0),
  };
}

export type AcaoSaldo = "MANTER" | "ENCERRAR" | "REPEDIR";

export type ResultadoSaldo = {
  acao: AcaoSaldo;
  /** Preenchido só no REPEDIR. */
  novoPedidoId?: string;
  novoPedidoNumero?: string;
  itens: number;
};

/**
 * Resolve o saldo. `itemIds` limita a ação a algumas linhas (o fornecedor
 * cortou duas, as outras ainda vêm) — vazio significa "todas as pendentes".
 */
export async function resolverSaldoPedido(input: {
  tenantId: string;
  pedidoId: string;
  acao: AcaoSaldo;
  motivo: string;
  itemIds?: string[];
  enviarNovoPedido?: boolean;
  userId?: string | null;
}): Promise<ResultadoSaldo> {
  const { tenantId, pedidoId, acao, motivo, userId } = input;

  const saldo = await saldoDoPedido(pedidoId);
  if (!saldo) throw new Error("Pedido não encontrado.");
  if (saldo.status === "CANCELADO") throw new Error("Pedido cancelado.");
  if (saldo.linhas.length === 0) throw new Error("Este pedido não tem saldo pendente.");

  const alvo = input.itemIds?.length
    ? saldo.linhas.filter((l) => input.itemIds!.includes(l.itemId))
    : saldo.linhas;
  if (alvo.length === 0) throw new Error("Nenhuma das linhas escolhidas tem saldo pendente.");

  if (acao === "MANTER") {
    await db.purchaseOrder.update({
      where: { id: pedidoId },
      data: { saldoResolucao: "PENDENTE", saldoMotivo: motivo, saldoResolvidoEm: null },
    });
    return { acao, itens: alvo.length };
  }

  // Encerra o que faltou: `qtdPedida` passa a ser o que realmente chegou, para
  // o pedido parar de aparecer como incompleto em toda tela que compara os
  // dois números. O quanto foi cortado fica no evento e no motivo.
  const parcial = alvo.length < saldo.linhas.length;

  let novo: { id: string; numero: string } | undefined;

  if (acao === "REPEDIR") {
    const novoId = await criarPedidoCompra(
      tenantId,
      {
        siteId: saldo.siteId,
        supplierId: saldo.supplierId,
        observacao: `Saldo do pedido ${saldo.numero} — ${motivo}`,
        origem: "MANUAL",
        origemPedidoId: pedidoId,
        items: alvo.map((l) => ({
          productId: l.productId,
          packagingId: l.packagingId,
          qtdPedida: l.saldo,
          custoUnitario: l.custoUnitario,
        })),
      },
      { enviar: input.enviarNovoPedido ?? false, createdBy: userId ?? undefined },
    );
    const criado = await db.purchaseOrder.findFirst({
      where: { id: novoId },
      select: { id: true, numero: true },
    });
    novo = criado ?? { id: novoId, numero: "—" };
  }

  for (const l of alvo) {
    await db.purchaseOrderItem.update({
      where: { id: l.itemId },
      data: { qtdPedida: l.qtdRecebida },
    });
  }

  // Só fecha o pedido quando não sobrou nenhuma pendência.
  const fecha = !parcial;
  await db.purchaseOrder.update({
    where: { id: pedidoId },
    data: {
      saldoResolucao: acao === "REPEDIR" ? "REPEDIDO" : "ENCERRADO",
      saldoResolvidoEm: new Date(),
      saldoMotivo: motivo,
      ...(fecha ? { status: "RECEBIDO" as const, recebidoEm: new Date() } : {}),
    },
  });

  await registrarEvento({
    tenantId,
    purchaseOrderId: pedidoId,
    tipo: acao === "REPEDIR" ? "SALDO_REPEDIDO" : "SALDO_ENCERRADO",
    descricao:
      acao === "REPEDIR"
        ? `Saldo de ${alvo.length} item(ns) virou o pedido ${novo?.numero}. Motivo: ${motivo}`
        : `Saldo de ${alvo.length} item(ns) encerrado sem entrega. Motivo: ${motivo}`,
    meta: { itens: alvo.length, novoPedidoId: novo?.id ?? null },
    createdBy: userId,
  });

  return { acao, novoPedidoId: novo?.id, novoPedidoNumero: novo?.numero, itens: alvo.length };
}

/**
 * Pedidos parados em recebimento parcial sem ninguém ter decidido o destino do
 * saldo. É a fila que a tela de pedidos mostra como pendência real.
 */
export async function pedidosComSaldoPendente(opts: { siteIds?: string[] | null } = {}) {
  return db.purchaseOrder.findMany({
    where: {
      status: "RECEBIDO_PARCIAL",
      saldoResolucao: "PENDENTE",
      ...(opts.siteIds?.length ? { siteId: { in: opts.siteIds } } : {}),
    },
    select: {
      id: true,
      numero: true,
      recebidoEm: true,
      updatedAt: true,
      previsaoEntrega: true,
      supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      items: { select: { qtdPedida: true, qtdRecebida: true, custoUnitario: true } },
    },
    orderBy: { updatedAt: "asc" },
    take: 50,
  });
}
