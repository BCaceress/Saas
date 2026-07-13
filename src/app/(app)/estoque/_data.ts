import { db } from "@/lib/prisma";
import { basePrisma } from "@/lib/prisma";
import { Decimal } from "@/generated/prisma/runtime/library";

const n = (v: Decimal | null | undefined) => (v == null ? 0 : Number(v));

// ── Tipos ───────────────────────────────────────────────────

export type SaldoRow = {
  productId: string;
  sku: string;
  ean: string | null;
  nome: string;
  tipo: string;
  unidadeBase: string;
  fracionavel: boolean;
  conteudoPorUnidade: number | null;
  estoqueFechado: number;
  estoqueAberto: number;
  estoqueMinimo: number;
  estoqueIdeal: number;
  custoMedio: number | null;
  abaixoMinimo: boolean;
  percentAberta: number | null;
  abertaEm: string | null; // ISO — última vez que uma unidade foi aberta (deltaAberto>0)
  // Consumo (un fechadas vendidas) por janela — base p/ cobertura e média.
  consumoHoje: number;
  consumo7: number;
  consumo30: number;
  ultimaMovTipo: string | null; // tipo da última movimentação
  ultimaMovEm: string | null;   // ISO
  ultimaCompraEm: string | null;
  ultimaVendaEm: string | null;
  // Próxima reposição (pedido de compra em aberto p/ este produto/site).
  reposEstado: "prevista" | "pedido" | "nenhuma";
  reposPrevisao: string | null; // ISO — previsão de entrega mais próxima
  reposQtd: number | null;      // qtd pendente somada
  locationNome: string | null;
  temFornecedor: boolean;
  categoria: string | null;
  marca: string | null;
  fornecedorNome: string | null;
  precoVenda: number | null;
  custo: number | null;
  imagemUrl: string | null;
};

export type MovimentacaoRow = {
  id: string;
  tipo: string;
  productId: string;
  productNome: string;
  productSku: string;
  productEan: string | null;
  deltaFechado: number;
  deltaAberto: number;
  saldoDepois: number | null; // saldo fechado após a movimentação (corrente ⇒ null se fora da janela)
  custoUnitario: number | null;
  valorTotal: number | null;
  origem: string; // rótulo curto: Compra, PDV, Produção, Ajuste…
  documento: string | null; // PC-00002, nº nota, id transferência…
  fornecedor: string | null;
  responsavel: string | null;
  local: string | null;
  observacao: string | null;
  createdAt: Date;
};

export type EntradaItemRow = {
  id: string;
  productNome: string;
  productSku: string;
  productTipo: string;
  packagingNome: string | null;
  packagingFator: number | null;
  quantidade: number;
  custoTotal: number;
};

export type EntradaRow = {
  id: string;
  tipo: string;
  supplierNome: string | null;
  numeroNota: string | null;
  numeroPedido: string | null;
  data: Date;
  registradoPor: string | null;
  totalItems: number;
  items: EntradaItemRow[];
};

export type ReposicaoRow = {
  productId: string;
  sku: string;
  nome: string;
  estoqueFechado: number;
  estoqueMinimo: number;
  estoqueIdeal: number;
  deficit: number;
  supplierNome: string | null;
  supplierId: string | null;
};

// ── Saldos ──────────────────────────────────────────────────

export async function loadSaldos(siteId: string | null): Promise<SaldoRow[]> {
  const where = siteId ? { siteId } : {};
  const stocks = await db.stock.findMany({
    where,
    include: {
      product: {
        select: {
          id: true, sku: true, ean: true, nome: true, tipo: true, unidadeBase: true,
          fracionavel: true, conteudoPorUnidade: true, custoMedio: true,
          precoVenda: true, custo: true, imagemUrl: true,
          brand: { select: { nome: true } },
          subcategory: { select: { nome: true } },
          suppliers: {
            select: { supplier: { select: { razaoSocial: true, nomeFantasia: true } } },
            orderBy: { isPrincipal: "desc" },
            take: 1,
          },
        },
      },
      location: { select: { nome: true } },
    },
    orderBy: { product: { nome: "asc" } },
  });

  const abertoIds = stocks.filter((s) => n(s.estoqueAberto) > 0).map((s) => s.productId);
  const productIds = stocks.map((s) => s.productId);
  const now = Date.now();
  const d30 = new Date(now - 30 * 864e5);
  const d7 = new Date(now - 7 * 864e5);
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);

  // Todas as consultas derivadas só dependem de `stocks` — rodam em paralelo
  // (antes eram 3 idas sequenciais ao banco).
  const [aberturas, vendas, movs, poItems] = await Promise.all([
    // Data de abertura: última movimentação que abriu uma unidade (deltaAberto>0),
    // só para os produtos que hoje têm saldo aberto.
    abertoIds.length > 0
      ? db.stockMovement.groupBy({
          by: ["productId"],
          where: {
            productId: { in: abertoIds },
            deltaAberto: { gt: 0 },
            ...(siteId ? { siteId } : {}),
          },
          _max: { createdAt: true },
        })
      : Promise.resolve([]),
    // Consumo: saídas (vendas) por janela — un fechadas.
    productIds.length > 0
      ? db.stockMovement.findMany({
          where: { productId: { in: productIds }, tipo: "SAIDA", createdAt: { gte: d30 }, ...(siteId ? { siteId } : {}) },
          select: { productId: true, deltaFechado: true, deltaAberto: true, createdAt: true },
        })
      : Promise.resolve([]),
    // Última movimentação (qualquer) + última compra/venda.
    productIds.length > 0
      ? db.stockMovement.findMany({
          where: { productId: { in: productIds }, ...(siteId ? { siteId } : {}) },
          select: { productId: true, tipo: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 5000,
        })
      : Promise.resolve([]),
    // Próxima reposição: itens de pedidos de compra em aberto p/ o produto/site.
    productIds.length > 0
      ? db.purchaseOrderItem.findMany({
          where: {
            productId: { in: productIds },
            purchaseOrder: {
              status: { in: ["ENVIADO", "AGUARDANDO", "RECEBIDO_PARCIAL"] },
              ...(siteId ? { siteId } : {}),
            },
          },
          select: {
            productId: true,
            qtdPedida: true,
            qtdRecebida: true,
            purchaseOrder: { select: { previsaoEntrega: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const aberturaMap = new Map<string, Date>();
  for (const a of aberturas) {
    if (a._max.createdAt) aberturaMap.set(a.productId, a._max.createdAt);
  }

  const consumoMap = new Map<string, { hoje: number; d7: number; d30: number }>();
  for (const v of vendas) {
    const q = Math.abs(n(v.deltaFechado)) || Math.abs(n(v.deltaAberto));
    if (q <= 0) continue;
    const c = consumoMap.get(v.productId) ?? { hoje: 0, d7: 0, d30: 0 };
    c.d30 += q;
    if (v.createdAt >= d7) c.d7 += q;
    if (v.createdAt >= startToday) c.hoje += q;
    consumoMap.set(v.productId, c);
  }

  const lastMap = new Map<string, { tipo: string; at: Date }>();
  const lastCompra = new Map<string, Date>();
  const lastVenda = new Map<string, Date>();
  for (const m of movs) {
    if (!lastMap.has(m.productId)) lastMap.set(m.productId, { tipo: m.tipo, at: m.createdAt });
    if (m.tipo === "ENTRADA" && !lastCompra.has(m.productId)) lastCompra.set(m.productId, m.createdAt);
    if (m.tipo === "SAIDA" && !lastVenda.has(m.productId)) lastVenda.set(m.productId, m.createdAt);
  }

  const reposMap = new Map<string, { previsao: Date | null; qtd: number }>();
  for (const it of poItems) {
    const pend = n(it.qtdPedida) - n(it.qtdRecebida);
    if (pend <= 0) continue;
    const prev = it.purchaseOrder.previsaoEntrega;
    const cur = reposMap.get(it.productId);
    if (!cur) {
      reposMap.set(it.productId, { previsao: prev, qtd: pend });
    } else {
      cur.qtd += pend;
      if (prev && (!cur.previsao || prev < cur.previsao)) cur.previsao = prev;
    }
  }

  return stocks.map((s) => {
    const ef = n(s.estoqueFechado);
    const ea = n(s.estoqueAberto);
    const cpu = s.product.conteudoPorUnidade ? n(s.product.conteudoPorUnidade) : null;
    const pct = cpu && cpu > 0 ? Math.round((ea / cpu) * 100) : null;
    return {
      productId: s.productId,
      sku: s.product.sku,
      ean: s.product.ean,
      nome: s.product.nome,
      tipo: s.product.tipo,
      unidadeBase: s.product.unidadeBase,
      fracionavel: s.product.fracionavel,
      conteudoPorUnidade: cpu,
      estoqueFechado: ef,
      estoqueAberto: ea,
      estoqueMinimo: n(s.estoqueMinimo),
      estoqueIdeal: n(s.estoqueIdeal),
      custoMedio: s.product.custoMedio ? n(s.product.custoMedio) : null,
      abaixoMinimo: ef < n(s.estoqueMinimo),
      percentAberta: pct,
      abertaEm: aberturaMap.get(s.productId)?.toISOString() ?? null,
      consumoHoje: consumoMap.get(s.productId)?.hoje ?? 0,
      consumo7: consumoMap.get(s.productId)?.d7 ?? 0,
      consumo30: consumoMap.get(s.productId)?.d30 ?? 0,
      ultimaMovTipo: lastMap.get(s.productId)?.tipo ?? null,
      ultimaMovEm: lastMap.get(s.productId)?.at.toISOString() ?? null,
      ultimaCompraEm: lastCompra.get(s.productId)?.toISOString() ?? null,
      ultimaVendaEm: lastVenda.get(s.productId)?.toISOString() ?? null,
      reposEstado: reposMap.has(s.productId)
        ? (reposMap.get(s.productId)!.previsao ? "prevista" : "pedido")
        : "nenhuma",
      reposPrevisao: reposMap.get(s.productId)?.previsao?.toISOString() ?? null,
      reposQtd: reposMap.get(s.productId)?.qtd ?? null,
      locationNome: s.location?.nome ?? null,
      temFornecedor: s.product.suppliers.length > 0,
      categoria: s.product.subcategory?.nome ?? null,
      marca: s.product.brand?.nome ?? null,
      fornecedorNome: s.product.suppliers[0]
        ? (s.product.suppliers[0].supplier.nomeFantasia ?? s.product.suppliers[0].supplier.razaoSocial)
        : null,
      precoVenda: s.product.precoVenda ? n(s.product.precoVenda) : null,
      custo: s.product.custo ? n(s.product.custo) : null,
      imagemUrl: s.product.imagemUrl,
    };
  });
}

// ── Movimentações ────────────────────────────────────────────

export async function loadMovimentacoes(
  siteId: string | null,
  filters: { productId?: string; tipo?: string; limit?: number }
): Promise<MovimentacaoRow[]> {
  const movements = await basePrisma.stockMovement.findMany({
    where: {
      ...(siteId ? { siteId } : {}),
      ...(filters.productId ? { productId: filters.productId } : {}),
      ...(filters.tipo ? { tipo: filters.tipo as never } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: filters.limit ?? 100,
  });

  const productIds = [...new Set(movements.map((m) => m.productId))];
  const purchaseIds = [...new Set(movements.flatMap((m) => (m.purchaseId ? [m.purchaseId] : [])))];
  const productionIds = [...new Set(movements.flatMap((m) => (m.productionId ? [m.productionId] : [])))];
  const userIds = [...new Set(movements.flatMap((m) => (m.createdBy ? [m.createdBy] : [])))];

  const [products, stocks, purchases, productions, users, sites] = await Promise.all([
    productIds.length
      ? db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, nome: true, sku: true, ean: true } })
      : Promise.resolve([]),
    productIds.length
      ? db.stock.findMany({
          where: { productId: { in: productIds }, ...(siteId ? { siteId } : {}) },
          select: { productId: true, estoqueFechado: true },
        })
      : Promise.resolve([]),
    purchaseIds.length
      ? db.purchase.findMany({
          where: { id: { in: purchaseIds } },
          select: {
            id: true,
            tipo: true,
            numeroNota: true,
            purchaseOrder: { select: { numero: true } },
            supplier: { select: { razaoSocial: true, nomeFantasia: true } },
          },
        })
      : Promise.resolve([]),
    productionIds.length
      ? db.production.findMany({ where: { id: { in: productionIds } }, select: { id: true, productId: true } })
      : Promise.resolve([]),
    // User mora nas tabelas de auth (não tenant-scoped): usa basePrisma.
    userIds.length
      ? basePrisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
    db.site.findMany({ select: { id: true, nome: true } }),
  ]);

  // Produto finalizado de cada produção (p/ descrever "Produção · <drink>").
  const prodOutputIds = [...new Set(productions.map((p) => p.productId))];
  const prodOutputNames = prodOutputIds.length
    ? await db.product.findMany({ where: { id: { in: prodOutputIds } }, select: { id: true, nome: true } })
    : [];
  const prodOutputMap = new Map(prodOutputNames.map((p) => [p.id, p.nome]));
  const productionMap = new Map(productions.map((p) => [p.id, prodOutputMap.get(p.productId) ?? null]));

  const prodMap = new Map(products.map((p) => [p.id, p]));
  const balMap = new Map(stocks.map((s) => [s.productId, n(s.estoqueFechado)]));
  const purchaseMap = new Map(purchases.map((p) => [p.id, p]));
  const userMap = new Map(users.map((u) => [u.id, u.name ?? u.email ?? null]));
  const siteMap = new Map(sites.map((s) => [s.id, s.nome]));

  // Saldo corrente por produto = saldoDepois da movimentação mais recente.
  // Caminhamos do topo (mais recente) subtraindo o delta p/ reconstruir cada linha.
  const running = new Map<string, number>();

  return movements.map((m) => {
    const deltaFechado = n(m.deltaFechado);
    const custoUnitario = m.custoUnitario ? n(m.custoUnitario) : null;

    let saldoDepois: number | null;
    if (running.has(m.productId)) {
      saldoDepois = running.get(m.productId)!;
    } else {
      saldoDepois = balMap.has(m.productId) ? balMap.get(m.productId)! : null;
    }
    running.set(m.productId, (saldoDepois ?? 0) - deltaFechado);

    const purchase = m.purchaseId ? purchaseMap.get(m.purchaseId) : null;
    const producaoNome = m.productionId ? (productionMap.get(m.productionId) ?? null) : null;
    const { origem, documento } = resolveOrigem(m.tipo, {
      purchase,
      transferId: m.transferId,
      saleId: m.saleId,
      producaoNome,
      delta: deltaFechado,
    });

    return {
      id: m.id,
      tipo: m.tipo,
      productId: m.productId,
      productNome: prodMap.get(m.productId)?.nome ?? m.productId,
      productSku: prodMap.get(m.productId)?.sku ?? "",
      productEan: prodMap.get(m.productId)?.ean ?? null,
      deltaFechado,
      deltaAberto: n(m.deltaAberto),
      saldoDepois,
      custoUnitario,
      valorTotal: custoUnitario != null ? custoUnitario * Math.abs(deltaFechado) : null,
      origem,
      documento,
      fornecedor: purchase?.supplier ? (purchase.supplier.nomeFantasia ?? purchase.supplier.razaoSocial) : null,
      responsavel: m.createdBy ? (userMap.get(m.createdBy) ?? null) : null,
      local: siteMap.get(m.siteId) ?? null,
      observacao: m.observacao,
      createdAt: m.createdAt,
    };
  });
}

// Descreve a origem em linguagem do operador (não códigos). Os códigos
// (nº pedido, NF, id) ficam em `documento`, exibidos só no painel de detalhes.
function resolveOrigem(
  tipo: string,
  ctx: {
    purchase?: {
      tipo: string;
      numeroNota: string | null;
      purchaseOrder: { numero: string } | null;
    } | null;
    transferId: string | null;
    saleId: string | null;
    producaoNome: string | null;
    delta: number;
  },
): { origem: string; documento: string | null } {
  const { purchase, transferId, saleId, producaoNome } = ctx;
  const purchaseDoc = purchase?.purchaseOrder?.numero
    ? purchase.purchaseOrder.numero
    : purchase?.numeroNota
      ? `NF ${purchase.numeroNota}`
      : null;

  switch (tipo) {
    case "ENTRADA":
      if (purchase?.purchaseOrder?.numero) return { origem: "Entrada por pedido de compra", documento: purchaseDoc };
      if (purchase) return { origem: "Entrada compra manual", documento: purchaseDoc };
      return { origem: "Entrada manual", documento: null };
    case "ABERTURA":
      return { origem: "Estoque inicial", documento: null };
    case "SAIDA":
      return { origem: saleId ? "Saída por PDV" : "Saída manual", documento: saleId ? `Venda #${saleId.slice(-6)}` : null };
    case "TRANSFERENCIA":
      return {
        origem: ctx.delta >= 0 ? "Transferência recebida" : "Transferência enviada",
        documento: transferId ? `TR-${transferId.slice(-6)}` : null,
      };
    case "PRODUCAO":
      return {
        origem: producaoNome ? `Produção ${producaoNome}` : "Produção",
        documento: null,
      };
    case "AJUSTE":
      return { origem: "Ajuste manual", documento: null };
    case "PERDA":
      return { origem: "Perda / quebra", documento: null };
    case "DEVOLUCAO_CLIENTE":
      return { origem: "Devolução de cliente", documento: null };
    case "DEVOLUCAO_FORNECEDOR":
      return { origem: "Devolução ao fornecedor", documento: null };
    default:
      return { origem: "Sistema", documento: null };
  }
}

// ── Entradas ─────────────────────────────────────────────────

export async function loadEntradas(siteId: string | null): Promise<EntradaRow[]> {
  const purchases = await db.purchase.findMany({
    where: siteId ? { siteId } : {},
    include: {
      supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      purchaseOrder: { select: { numero: true } },
      items: { select: { id: true, productId: true, packagingId: true, quantidade: true, custoTotal: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const allProductIds = [...new Set(purchases.flatMap((p) => p.items.map((i) => i.productId)))];
  const allPackagingIds = [...new Set(purchases.flatMap((p) => p.items.flatMap((i) => i.packagingId ? [i.packagingId] : [])))];
  const allUserIds = [...new Set(purchases.flatMap((p) => p.createdBy ? [p.createdBy] : []))];

  const [products, packagings, users] = await Promise.all([
    allProductIds.length > 0
      ? db.product.findMany({ where: { id: { in: allProductIds } }, select: { id: true, nome: true, sku: true, tipo: true } })
      : Promise.resolve([]),
    allPackagingIds.length > 0
      ? db.productPackaging.findMany({ where: { id: { in: allPackagingIds } }, select: { id: true, nome: true, fatorConversao: true } })
      : Promise.resolve([]),
    // User mora nas tabelas de auth (não tenant-scoped): usa basePrisma.
    allUserIds.length > 0
      ? basePrisma.user.findMany({ where: { id: { in: allUserIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
  ]);

  const prodMap = new Map(products.map((p) => [p.id, p]));
  const pkgMap = new Map(packagings.map((pk) => [pk.id, pk]));
  const userMap = new Map(users.map((u) => [u.id, u.name ?? u.email ?? null]));

  return purchases.map((p) => ({
    id: p.id,
    tipo: p.tipo,
    supplierNome: p.supplier ? (p.supplier.nomeFantasia ?? p.supplier.razaoSocial) : null,
    numeroNota: p.numeroNota,
    numeroPedido: p.purchaseOrder?.numero ?? null,
    data: p.data,
    registradoPor: p.createdBy ? (userMap.get(p.createdBy) ?? null) : null,
    totalItems: p.items.length,
    items: p.items.map((item) => ({
      id: item.id,
      productNome: prodMap.get(item.productId)?.nome ?? item.productId,
      productSku: prodMap.get(item.productId)?.sku ?? "",
      productTipo: prodMap.get(item.productId)?.tipo ?? "",
      packagingNome: item.packagingId ? (pkgMap.get(item.packagingId)?.nome ?? null) : null,
      packagingFator: item.packagingId ? (Number(pkgMap.get(item.packagingId)?.fatorConversao) || null) : null,
      quantidade: Number(item.quantidade),
      custoTotal: Number(item.custoTotal),
    })),
  }));
}

// ── Pedidos de compra (PurchaseOrder) ─────────────────────────

export type PedidoCompraItemView = {
  productId: string;
  nome: string;
  sku: string;
  imagemUrl: string | null;
  packagingNome: string | null;
  qtdPedida: number;
  qtdRecebida: number;
  custoUnitario: number;
};

export type PedidoCompraView = {
  id: string;
  numero: string;
  status: string;
  supplierId: string;
  supplierNome: string;
  siteId: string;
  siteNome: string;
  previsaoEntrega: Date | null;
  valorTotal: number;
  observacao: string | null;
  financeiroGerado: boolean;
  createdAt: Date;
  enviadoEm: Date | null;
  totalItems: number;
  items: PedidoCompraItemView[];
};

export async function loadPedidosCompra(): Promise<PedidoCompraView[]> {
  const pedidos = await db.purchaseOrder.findMany({
    include: {
      supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      site: { select: { nome: true } },
      items: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const productIds = [...new Set(pedidos.flatMap((p) => p.items.map((i) => i.productId)))];
  const packagingIds = [...new Set(pedidos.flatMap((p) => p.items.flatMap((i) => (i.packagingId ? [i.packagingId] : []))))];

  const [products, packagings] = await Promise.all([
    mapProdutos(productIds),
    packagingIds.length > 0
      ? db.productPackaging.findMany({ where: { id: { in: packagingIds } }, select: { id: true, nome: true } })
      : Promise.resolve([]),
  ]);
  const pkgMap = new Map(packagings.map((pk) => [pk.id, pk.nome]));

  return pedidos.map((p) => ({
    id: p.id,
    numero: p.numero,
    status: p.status,
    supplierId: p.supplierId,
    supplierNome: p.supplier ? (p.supplier.nomeFantasia ?? p.supplier.razaoSocial) : "—",
    siteId: p.siteId,
    siteNome: p.site.nome,
    previsaoEntrega: p.previsaoEntrega,
    valorTotal: n(p.valorTotal),
    observacao: p.observacao,
    financeiroGerado: p.financeiroGerado,
    createdAt: p.createdAt,
    enviadoEm: p.enviadoEm,
    totalItems: p.items.length,
    items: p.items.map((i) => ({
      productId: i.productId,
      nome: products.get(i.productId)?.nome ?? i.productId,
      sku: products.get(i.productId)?.sku ?? "",
      imagemUrl: products.get(i.productId)?.imagemUrl ?? null,
      packagingNome: i.packagingId ? (pkgMap.get(i.packagingId) ?? null) : null,
      qtdPedida: n(i.qtdPedida),
      qtdRecebida: n(i.qtdRecebida),
      custoUnitario: n(i.custoUnitario),
    })),
  }));
}

/** Pedidos abertos para conferência/recebimento, opcionalmente do site ativo. */
export async function loadPedidosAReceber(siteId: string | null): Promise<PedidoCompraView[]> {
  const all = await loadPedidosCompra();
  return all.filter(
    (p) =>
      ["ENVIADO", "AGUARDANDO", "RECEBIDO_PARCIAL"].includes(p.status) &&
      (!siteId || p.siteId === siteId),
  );
}

export async function loadComprasFormOptions() {
  const [suppliers, products, sites] = await Promise.all([
    db.supplier.findMany({ where: { ativo: true }, orderBy: { razaoSocial: "asc" }, select: { id: true, razaoSocial: true, nomeFantasia: true } }),
    db.product.findMany({
      where: { ativo: true, tipo: { in: ["SIMPLES", "INSUMO"] } },
      orderBy: { nome: "asc" },
      select: {
        id: true,
        nome: true,
        sku: true,
        imagemUrl: true,
        custoMedio: true,
        packagings: { select: { id: true, nome: true, fatorConversao: true, isCompraDefault: true } },
        suppliers: { select: { supplierId: true } },
      },
    }),
    db.site.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true, tipo: true } }),
  ]);

  return {
    suppliers,
    sites,
    products: products.map((p) => ({
      id: p.id,
      nome: p.nome,
      sku: p.sku,
      imagemUrl: p.imagemUrl,
      custoMedio: p.custoMedio ? n(p.custoMedio) : null,
      supplierIds: p.suppliers.map((s) => s.supplierId),
      packagings: p.packagings.map((pk) => ({
        id: pk.id,
        nome: pk.nome,
        fatorConversao: Number(pk.fatorConversao),
        isCompraDefault: pk.isCompraDefault,
      })),
    })),
  };
}

// ── Extrato de entradas (feed multi-origem, read-only) ────────
// Tudo que aumentou o estoque, agrupado por documento/origem:
// compra (fornecedor/manual), transferência recebida, ajuste (inventário/
// manual), devolução de cliente.

export type EntradaEvento = {
  id: string;
  origem: "COMPRA" | "MANUAL" | "TRANSFERENCIA" | "AJUSTE" | "DEVOLUCAO_CLIENTE";
  titulo: string;
  subtitulo: string | null;
  qtdItens: number | null; // documentos agrupados (compra, transferência)
  detalhe: string | null; // linha única (ajuste, devolução): "+2 Brahma"
  valor: number | null;
  data: Date;
  registradoPor: string | null;
};

export async function loadEntradasExtrato(siteId: string | null): Promise<EntradaEvento[]> {
  const fmtN = (v: number) => `${v > 0 ? "+" : ""}${v.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}`;

  // 1. Compras (Purchase) — já agrupadas por documento.
  const purchases = await loadEntradas(siteId);
  const eventos: EntradaEvento[] = purchases.map((p) => ({
    id: `purchase:${p.id}`,
    origem: p.tipo === "FORNECEDOR" ? "COMPRA" : "MANUAL",
    titulo: p.tipo === "FORNECEDOR" ? (p.supplierNome ?? "Fornecedor") : "Entrada manual",
    subtitulo: p.numeroPedido ? `Pedido ${p.numeroPedido}` : p.numeroNota ? `NF ${p.numeroNota}` : null,
    qtdItens: p.totalItems,
    detalhe: null,
    valor: p.items.reduce((s, i) => s + i.custoTotal, 0),
    data: p.data,
    registradoPor: p.registradoPor,
  }));

  // 2. Movimentos de entrada que não são compra (ENTRADA já coberta acima).
  const movs = await basePrisma.stockMovement.findMany({
    where: {
      ...(siteId ? { siteId } : {}),
      tipo: { in: ["AJUSTE", "TRANSFERENCIA", "DEVOLUCAO_CLIENTE"] },
      OR: [{ deltaFechado: { gt: 0 } }, { deltaAberto: { gt: 0 } }],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const prodMap = await mapProdutos([...new Set(movs.map((m) => m.productId))]);

  const transferIds = [...new Set(movs.flatMap((m) => (m.tipo === "TRANSFERENCIA" && m.transferId ? [m.transferId] : [])))];
  const transfers = transferIds.length
    ? await db.transfer.findMany({
        where: { id: { in: transferIds } },
        include: { origem: { select: { nome: true } }, destino: { select: { nome: true } } },
      })
    : [];
  const transferMap = new Map(transfers.map((t) => [t.id, t]));

  // Transferências recebidas: agrupa por transferId (1 evento, N itens).
  const transferAgg = new Map<string, { ids: Set<string>; data: Date }>();

  for (const m of movs) {
    const nome = prodMap.get(m.productId)?.nome ?? m.productId;
    const qtd = Number(m.deltaFechado) || Number(m.deltaAberto);

    if (m.tipo === "TRANSFERENCIA" && m.transferId) {
      const a = transferAgg.get(m.transferId) ?? { ids: new Set<string>(), data: m.createdAt };
      a.ids.add(m.productId);
      transferAgg.set(m.transferId, a);
    } else if (m.tipo === "AJUSTE") {
      const inv = m.observacao?.toLowerCase().includes("inventário");
      eventos.push({
        id: `mov:${m.id}`,
        origem: "AJUSTE",
        titulo: inv ? "Ajuste de inventário" : "Ajuste manual",
        subtitulo: null,
        qtdItens: null,
        detalhe: `${fmtN(qtd)} ${nome}`,
        valor: null,
        data: m.createdAt,
        registradoPor: null,
      });
    } else if ((m.tipo as string) === "DEVOLUCAO_CLIENTE") {
      eventos.push({
        id: `mov:${m.id}`,
        origem: "DEVOLUCAO_CLIENTE",
        titulo: "Devolução de cliente",
        subtitulo: null,
        qtdItens: null,
        detalhe: `${fmtN(qtd)} ${nome}`,
        valor: null,
        data: m.createdAt,
        registradoPor: null,
      });
    }
  }

  for (const [tid, a] of transferAgg) {
    const t = transferMap.get(tid);
    eventos.push({
      id: `transfer:${tid}`,
      origem: "TRANSFERENCIA",
      titulo: "Transferência recebida",
      subtitulo: t ? `${t.origem.nome} → ${t.destino.nome}` : null,
      qtdItens: a.ids.size,
      detalhe: null,
      valor: null,
      data: a.data,
      registradoPor: null,
    });
  }

  return eventos.sort((a, b) => b.data.getTime() - a.data.getTime()).slice(0, 100);
}

// ── Form options for entrada ──────────────────────────────────

export async function loadEntradaFormOptions() {
  // Select enxuto: só os campos que o NovaEntradaForm consome.
  const [products, suppliers, sites] = await Promise.all([
    db.product.findMany({
      where: { ativo: true, tipo: { in: ["SIMPLES", "INSUMO"] } },
      select: {
        id: true,
        nome: true,
        sku: true,
        imagemUrl: true,
        packagings: { select: { id: true, nome: true, fatorConversao: true, isCompraDefault: true } },
        suppliers: { select: { supplierId: true } },
        brand: { select: { nome: true } },
      },
      orderBy: { nome: "asc" },
    }),
    db.supplier.findMany({
      where: { ativo: true },
      orderBy: { razaoSocial: "asc" },
      select: { id: true, razaoSocial: true, nomeFantasia: true },
    }),
    db.site.findMany({
      where: { ativo: true },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true, tipo: true },
    }),
  ]);

  return { products, suppliers, sites };
}

// ── Reposição ─────────────────────────────────────────────────

export async function loadReposicao(siteId: string | null): Promise<ReposicaoRow[]> {
  const stocks = await db.stock.findMany({
    where: {
      ...(siteId ? { siteId } : {}),
    },
    include: {
      product: {
        select: {
          id: true,
          nome: true,
          sku: true,
          suppliers: {
            where: { isPrincipal: true },
            include: { supplier: { select: { id: true, razaoSocial: true, nomeFantasia: true } } },
          },
        },
      },
    },
  });

  return stocks
    .filter((s) => Number(s.estoqueFechado) < Number(s.estoqueMinimo))
    .map((s) => {
      const sup = s.product.suppliers[0]?.supplier;
      return {
        productId: s.productId,
        sku: s.product.sku,
        nome: s.product.nome,
        estoqueFechado: n(s.estoqueFechado),
        estoqueMinimo: n(s.estoqueMinimo),
        estoqueIdeal: n(s.estoqueIdeal),
        deficit: n(s.estoqueIdeal) - n(s.estoqueFechado),
        supplierNome: sup ? (sup.nomeFantasia ?? sup.razaoSocial) : null,
        supplierId: sup?.id ?? null,
      };
    })
    .sort((a, b) => (b.deficit - a.deficit));
}

// ── Produtos personalizados para produção ─────────────────────

export async function loadPersonalizados() {
  return db.product.findMany({
    where: { tipo: "PERSONALIZADO", ativo: true },
    include: {
      variants: { where: { ativo: true }, orderBy: { nome: "asc" } },
      components: {
        where: { groupId: null },
        include: { component: { select: { nome: true, unidadeBase: true } } },
      },
    },
    orderBy: { nome: "asc" },
  });
}

// ── Sites para transferência ──────────────────────────────────

export async function loadSitesTransferencia() {
  return db.site.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } });
}

// ── Distribuição CD→loja: requisições, expedição, recebimento ──

export type RequisicaoItemView = {
  productId: string;
  nome: string;
  sku: string;
  qtdSolicitada: number;
  qtdAtendida: number | null;
  saldoCd: number; // saldo fechado no CD (origem) — guia a expedição
};

export type RequisicaoView = {
  id: string;
  status: string;
  origemSiteId: string;
  origemNome: string;
  destinoSiteId: string;
  destinoNome: string;
  observacao: string | null;
  createdAt: Date;
  items: RequisicaoItemView[];
};

/** Helper: mapa productId -> {nome, sku, imagemUrl} para um conjunto de ids. */
async function mapProdutos(productIds: string[]) {
  if (productIds.length === 0) return new Map<string, { nome: string; sku: string; imagemUrl: string | null }>();
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, nome: true, sku: true, imagemUrl: true },
  });
  return new Map(products.map((p) => [p.id, { nome: p.nome, sku: p.sku, imagemUrl: p.imagemUrl }]));
}

/** Requisições recentes (abertas a atender + atendidas), com saldo no CD. */
export async function loadRequisicoes(): Promise<RequisicaoView[]> {
  const reqs = await db.requisicao.findMany({
    where: { status: { in: ["ABERTA", "ATENDIDA"] } },
    include: {
      origem: { select: { id: true, nome: true } },
      destino: { select: { id: true, nome: true } },
      items: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const productIds = [...new Set(reqs.flatMap((r) => r.items.map((i) => i.productId)))];
  const prodMap = await mapProdutos(productIds);

  const stocks = productIds.length
    ? await db.stock.findMany({
        where: { productId: { in: productIds } },
        select: { productId: true, siteId: true, estoqueFechado: true },
      })
    : [];
  const saldoMap = new Map(stocks.map((s) => [`${s.productId}:${s.siteId}`, n(s.estoqueFechado)]));

  return reqs.map((r) => ({
    id: r.id,
    status: r.status,
    origemSiteId: r.origemSiteId,
    origemNome: r.origem.nome,
    destinoSiteId: r.destinoSiteId,
    destinoNome: r.destino.nome,
    observacao: r.observacao,
    createdAt: r.createdAt,
    items: r.items.map((i) => ({
      productId: i.productId,
      nome: prodMap.get(i.productId)?.nome ?? i.productId,
      sku: prodMap.get(i.productId)?.sku ?? "",
      qtdSolicitada: n(i.qtdSolicitada),
      qtdAtendida: i.qtdAtendida != null ? n(i.qtdAtendida) : null,
      saldoCd: saldoMap.get(`${i.productId}:${r.origemSiteId}`) ?? 0,
    })),
  }));
}

export type TransferView = {
  id: string;
  origemSiteId: string;
  origemNome: string;
  destinoSiteId: string;
  destinoNome: string;
  expedidoEm: Date | null;
  observacao: string | null;
  items: { productId: string; nome: string; sku: string; imagemUrl: string | null; qtdExpedida: number }[];
};

/** Transfers EXPEDIDO filtrados por origem (CD: em trânsito) ou destino (loja: a receber). */
async function loadTransfersExpedidos(
  filter: { origemSiteId?: string; destinoSiteId?: string }
): Promise<TransferView[]> {
  const transfers = await db.transfer.findMany({
    where: {
      status: "EXPEDIDO",
      ...(filter.origemSiteId ? { origemSiteId: filter.origemSiteId } : {}),
      ...(filter.destinoSiteId ? { destinoSiteId: filter.destinoSiteId } : {}),
    },
    include: {
      origem: { select: { id: true, nome: true } },
      destino: { select: { id: true, nome: true } },
      items: true,
    },
    orderBy: { expedidoEm: "desc" },
  });

  const productIds = [...new Set(transfers.flatMap((t) => t.items.map((i) => i.productId)))];
  const prodMap = await mapProdutos(productIds);

  return transfers.map((t) => ({
    id: t.id,
    origemSiteId: t.origemSiteId,
    origemNome: t.origem.nome,
    destinoSiteId: t.destinoSiteId,
    destinoNome: t.destino.nome,
    expedidoEm: t.expedidoEm,
    observacao: t.observacao,
    items: t.items.map((i) => ({
      productId: i.productId,
      nome: prodMap.get(i.productId)?.nome ?? i.productId,
      sku: prodMap.get(i.productId)?.sku ?? "",
      imagemUrl: prodMap.get(i.productId)?.imagemUrl ?? null,
      qtdExpedida: n(i.qtdExpedida ?? i.quantidade),
    })),
  }));
}

/** Loja: transfers em trânsito com destino neste site (a conferir/receber). */
export function loadTransferenciasAReceber(siteId: string | null): Promise<TransferView[]> {
  return loadTransfersExpedidos(siteId ? { destinoSiteId: siteId } : {});
}

/** CD: transfers que saíram deste site e ainda não foram recebidos (em trânsito). */
export function loadEmTransito(siteId: string | null): Promise<TransferView[]> {
  return loadTransfersExpedidos(siteId ? { origemSiteId: siteId } : {});
}

// ── Inventário / contagem ─────────────────────────────────────

export type InventarioItemView = {
  productId: string;
  nome: string;
  sku: string;
  qtdSistema: number;
  qtdContada: number | null;
};

export type InventarioView = {
  id: string;
  status: string;
  siteId: string;
  siteNome: string;
  observacao: string | null;
  createdAt: Date;
  fechadoEm: Date | null;
  items: InventarioItemView[];
};

export async function loadInventarios(siteId: string | null): Promise<InventarioView[]> {
  const invs = await db.inventory.findMany({
    where: siteId ? { siteId } : {},
    include: {
      site: { select: { nome: true } },
      items: true,
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const productIds = [...new Set(invs.flatMap((i) => i.items.map((it) => it.productId)))];
  const prodMap = await mapProdutos(productIds);

  return invs.map((inv) => ({
    id: inv.id,
    status: inv.status,
    siteId: inv.siteId,
    siteNome: inv.site.nome,
    observacao: inv.observacao,
    createdAt: inv.createdAt,
    fechadoEm: inv.fechadoEm,
    items: inv.items.map((it) => ({
      productId: it.productId,
      nome: prodMap.get(it.productId)?.nome ?? it.productId,
      sku: prodMap.get(it.productId)?.sku ?? "",
      qtdSistema: n(it.qtdSistema),
      qtdContada: it.qtdContada != null ? n(it.qtdContada) : null,
    })),
  }));
}

/** Opções para o formulário de requisição (sites + produtos estocáveis). */
export async function loadRequisicaoFormOptions() {
  const [sites, products] = await Promise.all([
    db.site.findMany({
      where: { ativo: true },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true, tipo: true },
    }),
    db.product.findMany({
      where: { ativo: true, tipo: { in: ["SIMPLES", "INSUMO"] } },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true, sku: true },
    }),
  ]);
  return { sites, products };
}
