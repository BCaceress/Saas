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
        numeroNota: opts.numeroNota ?? null,
        observacao: opts.observacao ?? null,
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

// ── Motor de produção ────────────────────────────────────────

export async function registrarProducao(
  tenantId: string,
  siteId: string,
  productId: string,
  variantId: string | null,
  quantidade: number,
  opts: { observacao?: string | null; createdBy?: string; saleId?: string }
): Promise<string> {
  // Carrega o personalizado com seus componentes
  const produto = await basePrisma.product.findFirst({
    where: { id: productId, tenantId, tipo: "PERSONALIZADO" },
    include: {
      components: {
        where: { groupId: null },
        include: {
          component: { select: { id: true, nome: true, fracionavel: true, unidadeBase: true, conteudoPorUnidade: true } },
        },
      },
      variants: variantId ? { where: { id: variantId } } : false,
    },
  });
  if (!produto) throw new Error("Produto personalizado não encontrado.");

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

  // Processa cada componente
  for (const comp of produto.components) {
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
