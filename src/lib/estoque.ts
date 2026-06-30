import "server-only";
import { basePrisma } from "./prisma";
import type { MovementType } from "@/generated/prisma";

// ============================================================
// Serviço de estoque — toda operação é transacional e grava
// no razão (StockMovement) + atualiza Stock na mesma tx.
// Usa basePrisma diretamente (as transações precisam ser atômicas
// e SET LOCAL já é injetado pela extension em cada query, mas aqui
// controlamos a transação externamente).
// ============================================================

type StockDelta = {
  deltaFechado?: number;
  deltaAberto?: number;
};

/** Aplica deltas ao Stock e insere linha no razão — numa transação. */
export async function aplicarMovimento(
  tenantId: string,
  siteId: string,
  productId: string,
  tipo: MovementType,
  delta: StockDelta,
  opts: {
    custoUnitario?: number;
    purchaseId?: string;
    transferId?: string;
    productionId?: string;
    saleId?: string;
    observacao?: string;
    createdBy?: string;
  } = {}
) {
  const dF = delta.deltaFechado ?? 0;
  const dA = delta.deltaAberto ?? 0;

  await basePrisma.$transaction([
    basePrisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`,
    basePrisma.stockMovement.create({
      data: {
        tenantId,
        siteId,
        productId,
        tipo,
        deltaFechado: dF,
        deltaAberto: dA,
        custoUnitario: opts.custoUnitario ?? null,
        purchaseId: opts.purchaseId ?? null,
        transferId: opts.transferId ?? null,
        productionId: opts.productionId ?? null,
        saleId: opts.saleId ?? null,
        observacao: opts.observacao ?? null,
        createdBy: opts.createdBy ?? null,
      },
    }),
    basePrisma.stock.upsert({
      where: { productId_siteId: { productId, siteId } },
      create: {
        tenantId,
        productId,
        siteId,
        estoqueFechado: Math.max(0, dF),
        estoqueAberto: Math.max(0, dA),
      },
      update: {
        estoqueFechado: { increment: dF },
        estoqueAberto: { increment: dA },
      },
    }),
  ]);
}

// ── Entrada ─────────────────────────────────────────────────

export type EntradaItem = {
  productId: string;
  quantidade: number;
  custoTotal: number;
  packagingId?: string | null;
};

export async function registrarEntrada(
  tenantId: string,
  siteId: string,
  items: EntradaItem[],
  opts: {
    tipo: "MANUAL" | "FORNECEDOR";
    supplierId?: string | null;
    purchaseOrderId?: string | null;
    numeroNota?: string | null;
    observacao?: string | null;
    createdBy?: string;
  }
): Promise<string> {
  // 1. Resolve quantidades base (converte embalagem se necessário)
  const resolvedItems = await Promise.all(
    items.map(async (item) => {
      let qtdBase = item.quantidade;
      if (item.packagingId) {
        const pkg = await basePrisma.productPackaging.findUnique({
          where: { id: item.packagingId },
          select: { fatorConversao: true },
        });
        if (pkg) qtdBase = item.quantidade * Number(pkg.fatorConversao);
      }
      const custoUnitario = qtdBase > 0 ? item.custoTotal / qtdBase : 0;
      return { ...item, qtdBase, custoUnitario };
    })
  );

  // 2. Cria o Purchase
  const purchase = await basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`;
    const p = await tx.purchase.create({
      data: {
        tenantId,
        siteId,
        tipo: opts.tipo,
        supplierId: opts.supplierId ?? null,
        purchaseOrderId: opts.purchaseOrderId ?? null,
        numeroNota: opts.numeroNota ?? null,
        observacao: opts.observacao ?? null,
        createdBy: opts.createdBy ?? null,
        items: {
          create: resolvedItems.map((ri) => ({
            tenantId,
            productId: ri.productId,
            packagingId: ri.packagingId ?? null,
            quantidade: ri.quantidade,
            custoTotal: ri.custoTotal,
          })),
        },
      },
    });
    return p;
  });

  // 3. Para cada item: atualiza Stock + StockMovement + custoMedio
  for (const ri of resolvedItems) {
    // Custo médio ponderado global
    await recalcularCustoMedio(tenantId, ri.productId, ri.qtdBase, ri.custoTotal);

    await aplicarMovimento(tenantId, siteId, ri.productId, "ENTRADA", {
      deltaFechado: ri.qtdBase,
    }, {
      custoUnitario: ri.custoUnitario,
      purchaseId: purchase.id,
      observacao: opts.observacao ?? undefined,
      createdBy: opts.createdBy,
    });
  }

  return purchase.id;
}

// ── Pedido de compra (PurchaseOrder) ─────────────────────────
// O pedido é um documento: não mexe em estoque. A entrada só acontece na
// conferência do recebimento (Fase 3). Aqui só criamos/editamos/enviamos/
// cancelamos o pedido ao fornecedor.

export type PedidoItemInput = {
  productId: string;
  packagingId?: string | null;
  qtdPedida: number;
  custoUnitario: number; // por unidade de compra (embalagem)
};

/** Gera o próximo número sequencial PC-00001 por tenant. */
async function proximoNumeroPedido(tenantId: string): Promise<string> {
  const total = await basePrisma.purchaseOrder.count({ where: { tenantId } });
  return `PC-${String(total + 1).padStart(5, "0")}`;
}

const somaPedido = (items: PedidoItemInput[]) =>
  items.reduce((acc, i) => acc + i.qtdPedida * i.custoUnitario, 0);

export async function criarPedidoCompra(
  tenantId: string,
  data: {
    siteId: string;
    supplierId: string;
    previsaoEntrega?: Date | null;
    observacao?: string | null;
    items: PedidoItemInput[];
  },
  opts: { enviar?: boolean; createdBy?: string } = {}
): Promise<string> {
  const validos = data.items.filter((i) => i.productId && i.qtdPedida > 0);
  if (validos.length === 0) throw new Error("Adicione ao menos um item ao pedido.");

  const numero = await proximoNumeroPedido(tenantId);
  const enviar = opts.enviar ?? false;

  const po = await basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`;
    return tx.purchaseOrder.create({
      data: {
        tenantId,
        siteId: data.siteId,
        supplierId: data.supplierId,
        numero,
        status: enviar ? "ENVIADO" : "RASCUNHO",
        enviadoEm: enviar ? new Date() : null,
        previsaoEntrega: data.previsaoEntrega ?? null,
        observacao: data.observacao ?? null,
        valorTotal: somaPedido(validos),
        createdBy: opts.createdBy ?? null,
        items: {
          create: validos.map((i) => ({
            tenantId,
            productId: i.productId,
            packagingId: i.packagingId ?? null,
            qtdPedida: i.qtdPedida,
            custoUnitario: i.custoUnitario,
          })),
        },
      },
    });
  });
  return po.id;
}

/** Edita um pedido ainda em RASCUNHO (substitui os itens). */
export async function atualizarPedidoCompra(
  tenantId: string,
  pedidoId: string,
  data: {
    siteId: string;
    supplierId: string;
    previsaoEntrega?: Date | null;
    observacao?: string | null;
    items: PedidoItemInput[];
  }
): Promise<void> {
  const po = await basePrisma.purchaseOrder.findFirst({
    where: { id: pedidoId, tenantId },
    select: { status: true },
  });
  if (!po) throw new Error("Pedido não encontrado.");
  if (po.status !== "RASCUNHO") throw new Error("Só pedidos em rascunho podem ser editados.");

  const validos = data.items.filter((i) => i.productId && i.qtdPedida > 0);
  if (validos.length === 0) throw new Error("Adicione ao menos um item ao pedido.");

  await basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`;
    await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: pedidoId } });
    await tx.purchaseOrder.update({
      where: { id: pedidoId },
      data: {
        siteId: data.siteId,
        supplierId: data.supplierId,
        previsaoEntrega: data.previsaoEntrega ?? null,
        observacao: data.observacao ?? null,
        valorTotal: somaPedido(validos),
        items: {
          create: validos.map((i) => ({
            tenantId,
            productId: i.productId,
            packagingId: i.packagingId ?? null,
            qtdPedida: i.qtdPedida,
            custoUnitario: i.custoUnitario,
          })),
        },
      },
    });
  });
}

/** RASCUNHO → ENVIADO (manda ao fornecedor). */
export async function enviarPedidoCompra(tenantId: string, pedidoId: string): Promise<void> {
  const po = await basePrisma.purchaseOrder.findFirst({
    where: { id: pedidoId, tenantId },
    select: { status: true },
  });
  if (!po) throw new Error("Pedido não encontrado.");
  if (po.status !== "RASCUNHO") throw new Error("Este pedido já foi enviado.");
  await basePrisma.$transaction([
    basePrisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`,
    basePrisma.purchaseOrder.update({
      where: { id: pedidoId },
      data: { status: "ENVIADO", enviadoEm: new Date() },
    }),
  ]);
}

/** Marca um pedido ENVIADO como AGUARDANDO entrega (confirmado pelo fornecedor). */
export async function marcarAguardandoPedido(tenantId: string, pedidoId: string): Promise<void> {
  const po = await basePrisma.purchaseOrder.findFirst({
    where: { id: pedidoId, tenantId },
    select: { status: true },
  });
  if (!po) throw new Error("Pedido não encontrado.");
  if (po.status !== "ENVIADO") throw new Error("Só pedidos enviados podem aguardar entrega.");
  await basePrisma.$transaction([
    basePrisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`,
    basePrisma.purchaseOrder.update({
      where: { id: pedidoId },
      data: { status: "AGUARDANDO" },
    }),
  ]);
}

/** Cancela um pedido que ainda não foi (totalmente) recebido. */
export async function cancelarPedidoCompra(tenantId: string, pedidoId: string): Promise<void> {
  const po = await basePrisma.purchaseOrder.findFirst({
    where: { id: pedidoId, tenantId },
    select: { status: true },
  });
  if (!po) throw new Error("Pedido não encontrado.");
  if (po.status === "RECEBIDO") throw new Error("Pedido já recebido não pode ser cancelado.");
  if (po.status === "CANCELADO") throw new Error("Pedido já está cancelado.");
  await basePrisma.$transaction([
    basePrisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`,
    basePrisma.purchaseOrder.update({
      where: { id: pedidoId },
      data: { status: "CANCELADO", canceladoEm: new Date() },
    }),
  ]);
}

// ── Recebimento de pedido de compra ──────────────────────────
// Confere a mercadoria que chegou (pedido × recebido), gera a entrada no
// estoque (Purchase + movimentos + custo médio) e atualiza qtdRecebida/status
// do pedido. Suporta recebimento parcial (recebe o resto depois).

export type RecebimentoCompraInput = { productId: string; qtdRecebida: number };

export async function receberPedidoCompra(
  tenantId: string,
  pedidoId: string,
  contagem: RecebimentoCompraInput[],
  opts: { numeroNota?: string | null; gerarFinanceiro?: boolean; createdBy?: string }
): Promise<void> {
  const po = await basePrisma.purchaseOrder.findFirst({
    where: { id: pedidoId, tenantId },
    include: { items: true },
  });
  if (!po) throw new Error("Pedido não encontrado.");
  if (!["ENVIADO", "AGUARDANDO", "RECEBIDO_PARCIAL"].includes(po.status)) {
    throw new Error("Este pedido não está aberto para recebimento.");
  }

  // Itens efetivamente recebidos nesta conferência (qtd na unidade de compra).
  const recebidos = po.items
    .map((it) => {
      const conta = contagem.find((c) => c.productId === it.productId);
      const qtd = conta ? Math.max(0, conta.qtdRecebida) : 0;
      return { it, qtd };
    })
    .filter((r) => r.qtd > 0);

  if (recebidos.length === 0) throw new Error("Informe ao menos um item recebido.");

  // 1. Gera a entrada no estoque (reusa o motor de entrada — converte embalagem
  //    e atualiza custo médio). custoTotal = qtd × custo unitário do pedido.
  await registrarEntrada(
    tenantId,
    po.siteId,
    recebidos.map((r) => ({
      productId: r.it.productId,
      quantidade: r.qtd,
      custoTotal: r.qtd * Number(r.it.custoUnitario),
      packagingId: r.it.packagingId,
    })),
    {
      tipo: "FORNECEDOR",
      supplierId: po.supplierId,
      purchaseOrderId: po.id,
      numeroNota: opts.numeroNota ?? null,
      observacao: `Recebimento do pedido ${po.numero}`,
      createdBy: opts.createdBy,
    }
  );

  // 2. Acumula qtdRecebida em cada item e recalcula o status do pedido.
  const recebidoMap = new Map(recebidos.map((r) => [r.it.id, r.qtd]));
  const novoRecebido = po.items.map((it) => ({
    it,
    total: Number(it.qtdRecebida) + (recebidoMap.get(it.id) ?? 0),
  }));
  const completo = novoRecebido.every((r) => r.total >= Number(r.it.qtdPedida) - 0.0001);

  await basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`;
    for (const r of novoRecebido) {
      await tx.purchaseOrderItem.update({ where: { id: r.it.id }, data: { qtdRecebida: r.total } });
    }
    await tx.purchaseOrder.update({
      where: { id: pedidoId },
      data: {
        status: completo ? "RECEBIDO" : "RECEBIDO_PARCIAL",
        recebidoEm: completo ? new Date() : null,
        financeiroGerado: opts.gerarFinanceiro ? true : po.financeiroGerado,
      },
    });
  });
}

// ── Custo médio ponderado global ────────────────────────────

async function recalcularCustoMedio(
  tenantId: string,
  productId: string,
  qtdEntrada: number,
  custoTotalEntrada: number
) {
  const produto = await basePrisma.product.findFirst({
    where: { id: productId, tenantId },
    select: { custoMedio: true },
  });
  if (!produto) return;

  // Saldo total antes da entrada (soma de todos os sites)
  const agg = await basePrisma.stock.aggregate({
    where: { productId, tenantId },
    _sum: { estoqueFechado: true },
  });
  const saldoAntes = Number(agg._sum.estoqueFechado ?? 0);
  const custoMedioAtual = Number(produto.custoMedio ?? 0);

  const novoSaldo = saldoAntes + qtdEntrada;
  const novoCusto =
    novoSaldo > 0
      ? (custoMedioAtual * saldoAntes + custoTotalEntrada) / novoSaldo
      : custoTotalEntrada / qtdEntrada;

  await basePrisma.$transaction([
    basePrisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`,
    basePrisma.product.update({
      where: { id: productId },
      data: { custoMedio: novoCusto },
    }),
  ]);
}

// ── Ajuste ───────────────────────────────────────────────────

export async function registrarAjuste(
  tenantId: string,
  siteId: string,
  productId: string,
  delta: { fechado?: number; aberto?: number },
  observacao: string,
  createdBy?: string
) {
  await aplicarMovimento(tenantId, siteId, productId, "AJUSTE", {
    deltaFechado: delta.fechado ?? 0,
    deltaAberto: delta.aberto ?? 0,
  }, { observacao, createdBy });
}

// ── Perda ────────────────────────────────────────────────────

export async function registrarPerda(
  tenantId: string,
  siteId: string,
  productId: string,
  delta: { fechado?: number; aberto?: number },
  observacao: string,
  createdBy?: string
) {
  await aplicarMovimento(tenantId, siteId, productId, "PERDA", {
    deltaFechado: -(delta.fechado ?? 0),
    deltaAberto: -(delta.aberto ?? 0),
  }, { observacao, createdBy });
}

// ── Devolução ────────────────────────────────────────────────
// Cliente devolve → entra no estoque (+). Devolvido ao fornecedor → sai (−).
// Origem própria no razão (DEVOLUCAO_*) para o extrato distinguir.

export async function registrarDevolucao(
  tenantId: string,
  siteId: string,
  productId: string,
  tipo: "CLIENTE" | "FORNECEDOR",
  delta: { fechado?: number; aberto?: number },
  observacao: string,
  opts: { custoUnitario?: number; saleId?: string; purchaseId?: string; createdBy?: string } = {}
) {
  const mov: MovementType = tipo === "CLIENTE" ? "DEVOLUCAO_CLIENTE" : "DEVOLUCAO_FORNECEDOR";
  const sign = tipo === "CLIENTE" ? 1 : -1;
  await aplicarMovimento(
    tenantId,
    siteId,
    productId,
    mov,
    { deltaFechado: sign * (delta.fechado ?? 0), deltaAberto: sign * (delta.aberto ?? 0) },
    {
      observacao,
      custoUnitario: opts.custoUnitario,
      saleId: opts.saleId,
      purchaseId: opts.purchaseId,
      createdBy: opts.createdBy,
    }
  );
}

// ── Transferência ────────────────────────────────────────────

export type TransferItem = { productId: string; quantidade: number };

export async function registrarTransferencia(
  tenantId: string,
  origemSiteId: string,
  destinoSiteId: string,
  items: TransferItem[],
  opts: { observacao?: string | null; createdBy?: string }
): Promise<string> {
  // Valida saldo na origem
  for (const item of items) {
    const stock = await basePrisma.stock.findFirst({
      where: { productId: item.productId, siteId: origemSiteId, tenantId },
      select: { estoqueFechado: true },
    });
    const saldo = Number(stock?.estoqueFechado ?? 0);
    if (saldo < item.quantidade) {
      const prod = await basePrisma.product.findFirst({
        where: { id: item.productId },
        select: { nome: true },
      });
      throw new Error(
        `Saldo insuficiente de "${prod?.nome}" na origem para transferir ${item.quantidade} un — disponível: ${saldo}`
      );
    }
  }

  // Cria Transfer
  const transfer = await basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`;
    return tx.transfer.create({
      data: {
        tenantId,
        origemSiteId,
        destinoSiteId,
        observacao: opts.observacao ?? null,
        items: {
          create: items.map((i) => ({
            tenantId,
            productId: i.productId,
            quantidade: i.quantidade,
          })),
        },
      },
    });
  });

  // Aplica as duas pernas
  for (const item of items) {
    // Custo médio do produto para registrar nas movimentações
    const prod = await basePrisma.product.findFirst({
      where: { id: item.productId },
      select: { custoMedio: true },
    });
    const custo = Number(prod?.custoMedio ?? 0);

    await aplicarMovimento(tenantId, origemSiteId, item.productId, "TRANSFERENCIA", {
      deltaFechado: -item.quantidade,
    }, { transferId: transfer.id, custoUnitario: custo, createdBy: opts.createdBy });

    await aplicarMovimento(tenantId, destinoSiteId, item.productId, "TRANSFERENCIA", {
      deltaFechado: item.quantidade,
    }, { transferId: transfer.id, custoUnitario: custo, createdBy: opts.createdBy });
  }

  return transfer.id;
}

// ── Requisição interna (loja → CD) + expedição/recebimento ──
// Fluxo com estado (Fase C). Sem aprovação: loja pede e o CD separa/expede,
// gerando um Transfer. Se o tenant exige contagem, o Transfer fica EXPEDIDO
// (estoque em trânsito) até a loja confirmar o recebimento; senão, expedir
// já auto-confirma a entrada na loja.

export type RequisicaoItemInput = { productId: string; qtdSolicitada: number };

/** Loja (destino) cria a requisição ao CD (origem). Não mexe em saldo. */
export async function criarRequisicao(
  tenantId: string,
  origemSiteId: string,
  destinoSiteId: string,
  items: RequisicaoItemInput[],
  opts: { observacao?: string | null; createdBy?: string }
): Promise<string> {
  const validos = items.filter((i) => i.qtdSolicitada > 0);
  if (validos.length === 0) throw new Error("Adicione ao menos um item à requisição.");

  const req = await basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`;
    return tx.requisicao.create({
      data: {
        tenantId,
        origemSiteId,
        destinoSiteId,
        observacao: opts.observacao ?? null,
        createdBy: opts.createdBy ?? null,
        items: {
          create: validos.map((i) => ({
            tenantId,
            productId: i.productId,
            qtdSolicitada: i.qtdSolicitada,
          })),
        },
      },
    });
  });
  return req.id;
}

export type ExpedicaoItemInput = { productId: string; qtdExpedida: number };

/**
 * CD separa e expede a requisição: baixa o saldo do CD e gera o Transfer.
 * Se `recebimentoExigeContagem` do tenant for false, já soma na loja (RECEBIDO);
 * se true, deixa EXPEDIDO (em trânsito) aguardando a contagem na loja.
 */
export async function expedirRequisicao(
  tenantId: string,
  requisicaoId: string,
  itensExpedidos: ExpedicaoItemInput[],
  opts: { observacao?: string | null; createdBy?: string }
): Promise<string> {
  const req = await basePrisma.requisicao.findFirst({
    where: { id: requisicaoId, tenantId },
    include: { items: true },
  });
  if (!req) throw new Error("Requisição não encontrada.");
  if (req.status !== "ABERTA") throw new Error("Requisição já foi atendida ou cancelada.");

  const { origemSiteId, destinoSiteId } = req;
  const expedidos = itensExpedidos.filter((i) => i.qtdExpedida > 0);
  if (expedidos.length === 0) throw new Error("Informe ao menos um item com quantidade a expedir.");

  // Valida saldo no CD para todos os itens antes de mexer em qualquer saldo.
  for (const item of expedidos) {
    const stock = await basePrisma.stock.findFirst({
      where: { productId: item.productId, siteId: origemSiteId, tenantId },
      select: { estoqueFechado: true },
    });
    const saldo = Number(stock?.estoqueFechado ?? 0);
    if (saldo < item.qtdExpedida) {
      const prod = await basePrisma.product.findFirst({ where: { id: item.productId }, select: { nome: true } });
      throw new Error(
        `Saldo insuficiente de "${prod?.nome}" no CD para expedir ${item.qtdExpedida} un — disponível: ${saldo}`
      );
    }
  }

  const tenant = await basePrisma.tenant.findUnique({
    where: { id: tenantId },
    select: { recebimentoExigeContagem: true },
  });
  const exigeContagem = tenant?.recebimentoExigeContagem ?? false;

  // Cria o Transfer + marca a requisição como atendida (mesma transação).
  const transfer = await basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`;
    const t = await tx.transfer.create({
      data: {
        tenantId,
        origemSiteId,
        destinoSiteId,
        requisicaoId,
        status: exigeContagem ? "EXPEDIDO" : "RECEBIDO",
        expedidoEm: new Date(),
        recebidoEm: exigeContagem ? null : new Date(),
        observacao: opts.observacao ?? req.observacao ?? null,
        createdBy: opts.createdBy ?? null,
        items: {
          create: expedidos.map((i) => ({
            tenantId,
            productId: i.productId,
            quantidade: i.qtdExpedida,
            qtdExpedida: i.qtdExpedida,
            qtdRecebida: exigeContagem ? null : i.qtdExpedida,
          })),
        },
      },
    });
    await tx.requisicao.update({
      where: { id: requisicaoId },
      data: { status: "ATENDIDA", atendidaEm: new Date() },
    });
    // Grava qtdAtendida em cada item correspondente da requisição.
    for (const item of expedidos) {
      const reqItem = req.items.find((ri) => ri.productId === item.productId);
      if (reqItem) {
        await tx.requisicaoItem.update({
          where: { id: reqItem.id },
          data: { qtdAtendida: item.qtdExpedida },
        });
      }
    }
    return t;
  });

  // Pernas no razão: saída do CD sempre; entrada na loja só se auto-confirma.
  for (const item of expedidos) {
    const prod = await basePrisma.product.findFirst({ where: { id: item.productId }, select: { custoMedio: true } });
    const custo = Number(prod?.custoMedio ?? 0);

    await aplicarMovimento(tenantId, origemSiteId, item.productId, "TRANSFERENCIA", {
      deltaFechado: -item.qtdExpedida,
    }, { transferId: transfer.id, custoUnitario: custo, createdBy: opts.createdBy });

    if (!exigeContagem) {
      await aplicarMovimento(tenantId, destinoSiteId, item.productId, "TRANSFERENCIA", {
        deltaFechado: item.qtdExpedida,
      }, { transferId: transfer.id, custoUnitario: custo, createdBy: opts.createdBy });
    }
  }

  return transfer.id;
}

export type RecebimentoItemInput = { productId: string; qtdRecebida: number };

/**
 * Loja confere e recebe um Transfer EXPEDIDO. Entra na loja o que foi expedido;
 * o que faltou (expedido − recebido) vira PERDA de trânsito ligada ao Transfer.
 */
export async function receberTransferencia(
  tenantId: string,
  transferId: string,
  contagem: RecebimentoItemInput[],
  opts: { createdBy?: string }
): Promise<void> {
  const transfer = await basePrisma.transfer.findFirst({
    where: { id: transferId, tenantId },
    include: { items: true },
  });
  if (!transfer) throw new Error("Transferência não encontrada.");
  if (transfer.status !== "EXPEDIDO") throw new Error("Esta transferência não está em trânsito.");

  const destinoSiteId = transfer.destinoSiteId;
  let temDivergencia = false;

  for (const ti of transfer.items) {
    const expedida = Number(ti.qtdExpedida ?? ti.quantidade);
    const conta = contagem.find((c) => c.productId === ti.productId);
    const recebida = conta ? Math.max(0, conta.qtdRecebida) : expedida;

    const prod = await basePrisma.product.findFirst({ where: { id: ti.productId }, select: { custoMedio: true } });
    const custo = Number(prod?.custoMedio ?? 0);

    // Entra na loja o expedido cheio; a divergência é baixada como PERDA logo
    // abaixo, deixando o razão consistente (recebido = expedido − perda).
    await aplicarMovimento(tenantId, destinoSiteId, ti.productId, "TRANSFERENCIA", {
      deltaFechado: expedida,
    }, { transferId, custoUnitario: custo, createdBy: opts.createdBy });

    const faltou = expedida - recebida;
    if (faltou > 0.0001) {
      temDivergencia = true;
      await aplicarMovimento(tenantId, destinoSiteId, ti.productId, "PERDA", {
        deltaFechado: -faltou,
      }, {
        transferId,
        custoUnitario: custo,
        createdBy: opts.createdBy,
        observacao: `Divergência no recebimento da transferência: expedido ${expedida}, recebido ${recebida}`,
      });
    }

    await basePrisma.$transaction([
      basePrisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`,
      basePrisma.transferItem.update({ where: { id: ti.id }, data: { qtdRecebida: recebida } }),
    ]);
  }

  await basePrisma.$transaction([
    basePrisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`,
    basePrisma.transfer.update({
      where: { id: transferId },
      data: { status: "RECEBIDO", recebidoEm: new Date(), temDivergencia },
    }),
  ]);
}

/** Cancela uma requisição ainda ABERTA. */
export async function cancelarRequisicao(tenantId: string, requisicaoId: string): Promise<void> {
  const req = await basePrisma.requisicao.findFirst({
    where: { id: requisicaoId, tenantId },
    select: { status: true },
  });
  if (!req) throw new Error("Requisição não encontrada.");
  if (req.status !== "ABERTA") throw new Error("Só requisições abertas podem ser canceladas.");
  await basePrisma.$transaction([
    basePrisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`,
    basePrisma.requisicao.update({ where: { id: requisicaoId }, data: { status: "CANCELADA" } }),
  ]);
}

// ── Inventário / contagem ────────────────────────────────────
// Abertura tira snapshot do saldo fechado por produto no site. Fechamento
// reconcilia: para cada item contado, gera um AJUSTE = (contado − saldo atual).

/** Abre um inventário no site, fotografando o saldo atual de todos os produtos. */
export async function criarInventario(
  tenantId: string,
  siteId: string,
  opts: { observacao?: string | null; createdBy?: string }
): Promise<string> {
  const stocks = await basePrisma.stock.findMany({
    where: { siteId, tenantId },
    select: { productId: true, estoqueFechado: true },
  });
  if (stocks.length === 0) {
    throw new Error("Nenhum produto com estoque neste site para inventariar.");
  }

  const inv = await basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`;
    return tx.inventory.create({
      data: {
        tenantId,
        siteId,
        observacao: opts.observacao ?? null,
        createdBy: opts.createdBy ?? null,
        items: {
          create: stocks.map((s) => ({
            tenantId,
            productId: s.productId,
            qtdSistema: s.estoqueFechado,
          })),
        },
      },
    });
  });
  return inv.id;
}

export type ContagemInput = { productId: string; qtdContada: number };

/** Fecha o inventário: grava a contagem e ajusta o saldo pela divergência. */
export async function fecharInventario(
  tenantId: string,
  inventoryId: string,
  contagens: ContagemInput[],
  opts: { createdBy?: string }
): Promise<void> {
  const inv = await basePrisma.inventory.findFirst({
    where: { id: inventoryId, tenantId },
    include: { items: true },
  });
  if (!inv) throw new Error("Inventário não encontrado.");
  if (inv.status !== "ABERTO") throw new Error("Inventário já fechado ou cancelado.");

  const siteId = inv.siteId;

  for (const item of inv.items) {
    const conta = contagens.find((c) => c.productId === item.productId);
    if (!conta) continue; // item não contado → mantém saldo, sem ajuste
    const contada = Math.max(0, conta.qtdContada);

    // Saldo atual no momento do fechamento (não o snapshot — pode ter havido venda).
    const stock = await basePrisma.stock.findFirst({
      where: { productId: item.productId, siteId, tenantId },
      select: { estoqueFechado: true },
    });
    const atual = Number(stock?.estoqueFechado ?? 0);
    const delta = contada - atual;

    await basePrisma.$transaction([
      basePrisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`,
      basePrisma.inventoryItem.update({ where: { id: item.id }, data: { qtdContada: contada } }),
    ]);

    if (Math.abs(delta) > 0.0001) {
      await registrarAjuste(
        tenantId,
        siteId,
        item.productId,
        { fechado: delta },
        `Inventário ${inventoryId.slice(0, 8)} — contado ${contada}, sistema ${atual}`,
        opts.createdBy
      );
    }
  }

  await basePrisma.$transaction([
    basePrisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`,
    basePrisma.inventory.update({
      where: { id: inventoryId },
      data: { status: "FECHADO", fechadoEm: new Date() },
    }),
  ]);
}

/** Cancela um inventário ABERTO sem aplicar ajustes. */
export async function cancelarInventario(tenantId: string, inventoryId: string): Promise<void> {
  const inv = await basePrisma.inventory.findFirst({
    where: { id: inventoryId, tenantId },
    select: { status: true },
  });
  if (!inv) throw new Error("Inventário não encontrado.");
  if (inv.status !== "ABERTO") throw new Error("Só inventários abertos podem ser cancelados.");
  await basePrisma.$transaction([
    basePrisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`,
    basePrisma.inventory.update({ where: { id: inventoryId }, data: { status: "CANCELADO" } }),
  ]);
}

// ── Motor de produção ────────────────────────────────────────

export async function registrarProducao(
  tenantId: string,
  siteId: string,
  productId: string,
  variantId: string | null,
  quantidade: number,
  opts: {
    observacao?: string | null;
    createdBy?: string;
    saleId?: string;
    /** Componentes escolhidos no PDV. Vazio/ausente => usa os itens padrão. */
    selectedComponentIds?: string[];
  }
): Promise<string> {
  // Carrega o personalizado com TODOS os componentes (soltos + de grupos)
  const produto = await basePrisma.product.findFirst({
    where: { id: productId, tenantId, tipo: "PERSONALIZADO" },
    include: {
      components: {
        include: {
          component: { select: { id: true, nome: true, fracionavel: true, unidadeBase: true, conteudoPorUnidade: true } },
        },
      },
      variants: variantId ? { where: { id: variantId } } : false,
    },
  });
  if (!produto) throw new Error("Produto personalizado não encontrado.");

  // Define quais componentes consumir:
  //  - soltos (groupId null): sempre;
  //  - de grupo: os escolhidos no PDV; sem escolha explícita, os marcados padrão.
  const selecionados = new Set(opts.selectedComponentIds ?? []);
  const usarEscolhas = selecionados.size > 0;
  const componentesAtivos = produto.components.filter((comp) => {
    if (comp.groupId == null) return true;
    if (usarEscolhas) return selecionados.has(comp.componentProductId);
    return comp.isDefault;
  });

  const fatorEscala = variantId && Array.isArray(produto.variants) && produto.variants.length > 0
    ? Number((produto.variants as Array<{ fatorEscala: unknown }>)[0].fatorEscala)
    : 1;

  // Cria o registro de Production
  const production = await basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`;
    return tx.production.create({
      data: {
        tenantId,
        siteId,
        productId,
        variantId: variantId ?? null,
        quantidade,
        saleId: opts.saleId ?? null,
        observacao: opts.observacao ?? null,
      },
    });
  });

  // Processa cada componente ativo
  for (const comp of componentesAtivos) {
    const c = comp.component;
    const doseTotal = Number(comp.quantidade) * fatorEscala * quantidade;

    if (c.fracionavel && c.unidadeBase !== "UN") {
      // Lógica de dois saldos: consome do aberto; abre novas unidades conforme necessário
      await consumirFracionado(tenantId, siteId, c, doseTotal, production.id, opts.createdBy, opts.saleId);
    } else {
      // Consome unidades fechadas diretamente
      const stock = await basePrisma.stock.findFirst({
        where: { productId: c.id, siteId, tenantId },
        select: { estoqueFechado: true },
      });
      const saldo = Number(stock?.estoqueFechado ?? 0);
      if (saldo < doseTotal) {
        throw new Error(`Saldo insuficiente de "${c.nome}" — disponível: ${saldo} un, necessário: ${doseTotal} un`);
      }
      await aplicarMovimento(tenantId, siteId, c.id, "PRODUCAO", {
        deltaFechado: -doseTotal,
      }, { productionId: production.id, saleId: opts.saleId, createdBy: opts.createdBy });
    }
  }

  return production.id;
}

async function consumirFracionado(
  tenantId: string,
  siteId: string,
  component: { id: string; nome: string; conteudoPorUnidade: unknown },
  doseTotal: number,
  productionId: string,
  createdBy?: string,
  saleId?: string
) {
  const conteudo = Number(component.conteudoPorUnidade ?? 0);
  if (conteudo <= 0) throw new Error(`Produto "${component.nome}" fracionável sem conteúdo por unidade definido.`);

  let restante = doseTotal;

  while (restante > 0.0001) {
    // Lê saldo atual (fora da tx para ter o valor mais recente a cada iteração)
    const stock = await basePrisma.stock.findFirst({
      where: { productId: component.id, siteId, tenantId },
      select: { estoqueFechado: true, estoqueAberto: true },
    });
    const fechado = Number(stock?.estoqueFechado ?? 0);
    const aberto = Number(stock?.estoqueAberto ?? 0);

    if (aberto >= restante) {
      // Consome tudo do aberto
      await aplicarMovimento(tenantId, siteId, component.id, "PRODUCAO", {
        deltaAberto: -restante,
      }, { productionId, saleId, createdBy });
      restante = 0;
    } else {
      // Consome o que há no aberto
      if (aberto > 0.0001) {
        await aplicarMovimento(tenantId, siteId, component.id, "PRODUCAO", {
          deltaAberto: -aberto,
        }, { productionId, saleId, createdBy });
        restante -= aberto;
      }
      // Abre uma nova unidade fechada
      if (fechado < 1) {
        throw new Error(`Saldo insuficiente de "${component.nome}" — sem unidades fechadas para abrir`);
      }
      await aplicarMovimento(tenantId, siteId, component.id, "ABERTURA", {
        deltaFechado: -1,
        deltaAberto: conteudo,
      }, { productionId, saleId, createdBy });
    }
  }
}
