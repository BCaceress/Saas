import { db } from "@/lib/prisma";
import { basePrisma } from "@/lib/prisma";
import { Decimal } from "@/generated/prisma/runtime/library";
import type { TipoItemPedido, MotivoBonificacao } from "@/lib/estoque";

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
  reposEstado: "ENVIADO" | "AGUARDANDO" | "EM_TRANSITO" | "RECEBIDO_PARCIAL" | "nenhuma";
  reposPrevisao: string | null; // ISO — previsão de entrega mais próxima
  reposQtd: number | null;      // qtd pendente somada (todos os pedidos em aberto)
  reposNumero: string | null;   // nº do pedido em destaque (menor previsão, ou mais antigo)
  reposSupplierNome: string | null;
  reposOrdersCount: number;     // quantos pedidos em aberto têm este produto
  locationNome: string | null;
  locationTipo: "AMBIENTE" | "REFRIGERADO" | "CONGELADO" | null;
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
  const where = { ...(siteId ? { siteId } : {}), product: { controlaEstoque: true } };
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
      location: { select: { nome: true, tipo: true } },
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
              status: { in: ["ENVIADO", "AGUARDANDO", "EM_TRANSITO", "RECEBIDO_PARCIAL"] },
              ...(siteId ? { siteId } : {}),
            },
          },
          select: {
            productId: true,
            qtdPedida: true,
            qtdRecebida: true,
            purchaseOrder: {
              select: {
                numero: true,
                status: true,
                previsaoEntrega: true,
                createdAt: true,
                supplier: { select: { razaoSocial: true, nomeFantasia: true } },
              },
            },
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

  // Pedido em destaque por produto: o de previsão mais próxima (ou, sem
  // previsão em nenhum, o mais antigo) — os demais só somam na quantidade.
  type ReposAgg = {
    previsao: Date | null;
    qtd: number;
    status: string;
    numero: string;
    supplierNome: string | null;
    createdAt: Date;
    orders: Set<string>;
  };
  const reposMap = new Map<string, ReposAgg>();
  for (const it of poItems) {
    const pend = n(it.qtdPedida) - n(it.qtdRecebida);
    if (pend <= 0) continue;
    const po = it.purchaseOrder;
    const supplierNome = po.supplier ? (po.supplier.nomeFantasia ?? po.supplier.razaoSocial) : null;
    const cur = reposMap.get(it.productId);
    if (!cur) {
      reposMap.set(it.productId, {
        previsao: po.previsaoEntrega,
        qtd: pend,
        status: po.status,
        numero: po.numero,
        supplierNome,
        createdAt: po.createdAt,
        orders: new Set([po.numero]),
      });
      continue;
    }
    cur.qtd += pend;
    cur.orders.add(po.numero);
    const melhora =
      po.previsaoEntrega && (!cur.previsao || po.previsaoEntrega < cur.previsao)
        ? true
        : !po.previsaoEntrega && !cur.previsao && po.createdAt < cur.createdAt;
    if (melhora) {
      cur.previsao = po.previsaoEntrega;
      cur.status = po.status;
      cur.numero = po.numero;
      cur.supplierNome = supplierNome;
      cur.createdAt = po.createdAt;
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
      reposEstado: (reposMap.get(s.productId)?.status as SaldoRow["reposEstado"]) ?? "nenhuma",
      reposPrevisao: reposMap.get(s.productId)?.previsao?.toISOString() ?? null,
      reposQtd: reposMap.get(s.productId)?.qtd ?? null,
      reposNumero: reposMap.get(s.productId)?.numero ?? null,
      reposSupplierNome: reposMap.get(s.productId)?.supplierNome ?? null,
      reposOrdersCount: reposMap.get(s.productId)?.orders.size ?? 0,
      locationNome: s.location?.nome ?? null,
      locationTipo: s.location?.tipo ?? null,
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

// Filtros estruturados — resolvidos no banco (não sobre uma janela de N linhas),
// para o extrato ser confiável em qualquer período/página.
export type MovimentacoesFiltro = {
  q?: string;
  chip?: string; // todos | entradas | vendas | saidas | transferencias | producao | ajustes
  dias?: number | null; // null = todo período; 0 = hoje
  origem?: string; // id de ORIGEM (venda_totem, ajuste_inventario, …)
  responsavel?: string; // userId · "__sistema" = sem responsável
  pagina?: number;
  porPagina?: number;
};

export type MovimentacoesResult = {
  rows: MovimentacaoRow[];
  total: number;
  pagina: number;
  porPagina: number;
  responsaveis: { id: string; nome: string }[];
};

export const MOV_POR_PAGINA_MAX = 250;

type MovWhere = Record<string, unknown>;

const CHIP_WHERE: Record<string, MovWhere | undefined> = {
  entradas: { tipo: { in: ["ENTRADA", "DEVOLUCAO_CLIENTE"] } },
  vendas: { saleId: { not: null }, tipo: { in: ["SAIDA", "ABERTURA"] } },
  saidas: { OR: [{ tipo: "SAIDA", saleId: null }, { tipo: { in: ["PERDA", "DEVOLUCAO_FORNECEDOR"] } }] },
  transferencias: { tipo: "TRANSFERENCIA" },
  producao: { tipo: "PRODUCAO" },
  ajustes: { tipo: "AJUSTE" },
};

// Cada origem exibida na tela tem uma condição equivalente no banco — o filtro
// devolve exatamente as linhas que receberiam aquele rótulo em resolveOrigem.
function origemWhere(id: string): MovWhere | "venda" | null {
  switch (id) {
    case "compra":
      return { tipo: "ENTRADA", purchaseId: { not: null } };
    case "entrada_manual":
      return { tipo: "ENTRADA", purchaseId: null };
    case "venda_pdv":
    case "venda_totem":
    case "venda_app":
      return "venda"; // precisa de subconsulta em Sale (canal)
    case "saida_manual":
      return { tipo: "SAIDA", saleId: null };
    case "abertura":
      return { tipo: "ABERTURA" };
    case "transferencia":
      return { tipo: "TRANSFERENCIA" };
    case "producao":
      return { tipo: "PRODUCAO" };
    case "ajuste_manual":
      return { tipo: "AJUSTE", saleId: null, NOT: { observacao: { startsWith: "Inventário" } } };
    case "ajuste_inventario":
      return { tipo: "AJUSTE", observacao: { startsWith: "Inventário" } };
    case "estorno_venda":
      return { tipo: "AJUSTE", saleId: { not: null } };
    case "perda":
      return { tipo: "PERDA" };
    case "devolucao_cliente":
      return { tipo: "DEVOLUCAO_CLIENTE" };
    case "devolucao_fornecedor":
      return { tipo: "DEVOLUCAO_FORNECEDOR" };
    default:
      return null;
  }
}

export async function loadMovimentacoes(
  siteId: string | null,
  filtro: MovimentacoesFiltro = {}
): Promise<MovimentacoesResult> {
  const porPagina = Math.min(Math.max(filtro.porPagina ?? 100, 10), MOV_POR_PAGINA_MAX);
  const paginaPedida = Math.max(filtro.pagina ?? 1, 1);

  const and: MovWhere[] = [];
  if (siteId) and.push({ siteId });

  const chipWhere = filtro.chip ? CHIP_WHERE[filtro.chip] : undefined;
  if (chipWhere) and.push(chipWhere);

  if (filtro.dias != null) {
    const limite = new Date();
    if (filtro.dias === 0) limite.setHours(0, 0, 0, 0);
    else limite.setDate(limite.getDate() - filtro.dias);
    and.push({ createdAt: { gte: limite } });
  }

  if (filtro.origem) {
    const ow = origemWhere(filtro.origem);
    if (ow === "venda") {
      const canal = filtro.origem === "venda_totem" ? "TOTEM" : filtro.origem === "venda_app" ? "APP" : "PDV";
      const vendas = await db.sale.findMany({
        where: { origem: canal as never, ...(siteId ? { siteId } : {}) },
        select: { id: true },
      });
      and.push({ tipo: { in: ["SAIDA", "ABERTURA"] }, saleId: { in: vendas.map((v) => v.id) } });
    } else if (ow) {
      and.push(ow);
    }
  }

  if (filtro.responsavel === "__sistema") and.push({ createdBy: null });
  else if (filtro.responsavel) and.push({ createdBy: filtro.responsavel });

  const q = filtro.q?.trim();
  if (q) {
    const prods = await db.product.findMany({
      where: {
        OR: [
          { nome: { contains: q, mode: "insensitive" } },
          { sku: { contains: q, mode: "insensitive" } },
          { ean: { contains: q } },
        ],
      },
      select: { id: true },
      take: 1000,
    });
    and.push({
      OR: [
        { productId: { in: prods.map((p) => p.id) } },
        { observacao: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  const where = and.length ? { AND: and } : {};

  // Responsáveis distintos (para o filtro) — só do site ativo.
  const [total, distinctBy] = await Promise.all([
    db.stockMovement.count({ where: where as never }),
    db.stockMovement.findMany({
      where: siteId ? { siteId } : {},
      distinct: ["createdBy"],
      select: { createdBy: true },
    }),
  ]);

  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const pagina = Math.min(paginaPedida, totalPaginas);

  const movements = await db.stockMovement.findMany({
    where: where as never,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (pagina - 1) * porPagina,
    take: porPagina,
  });

  const respIds = distinctBy.flatMap((d) => (d.createdBy ? [d.createdBy] : []));
  const respUsers = respIds.length
    ? await basePrisma.user.findMany({ where: { id: { in: respIds } }, select: { id: true, name: true, email: true } })
    : [];
  const responsaveis = respUsers
    .map((u) => ({ id: u.id, nome: u.name ?? u.email ?? u.id }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  const productIds = [...new Set(movements.map((m) => m.productId))];
  const purchaseIds = [...new Set(movements.flatMap((m) => (m.purchaseId ? [m.purchaseId] : [])))];
  const productionIds = [...new Set(movements.flatMap((m) => (m.productionId ? [m.productionId] : [])))];
  const saleIds = [...new Set(movements.flatMap((m) => (m.saleId ? [m.saleId] : [])))];
  const userIds = [...new Set(movements.flatMap((m) => (m.createdBy ? [m.createdBy] : [])))];

  const [products, stocks, purchases, productions, sales, users, sites] = await Promise.all([
    productIds.length
      ? db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, nome: true, sku: true, ean: true } })
      : Promise.resolve([]),
    productIds.length
      ? db.stock.findMany({
          where: { productId: { in: productIds }, ...(siteId ? { siteId } : {}) },
          select: { productId: true, siteId: true, estoqueFechado: true },
        })
      : Promise.resolve([]),
    purchaseIds.length
      ? db.purchase.findMany({
          where: { id: { in: purchaseIds } },
          select: {
            id: true,
            tipo: true,
            motivo: true,
            numeroNota: true,
            purchaseOrder: { select: { numero: true } },
            supplier: { select: { razaoSocial: true, nomeFantasia: true } },
          },
        })
      : Promise.resolve([]),
    productionIds.length
      ? db.production.findMany({ where: { id: { in: productionIds } }, select: { id: true, productId: true } })
      : Promise.resolve([]),
    saleIds.length
      ? db.sale.findMany({ where: { id: { in: saleIds } }, select: { id: true, origem: true } })
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
  const balMap = new Map(stocks.map((s) => [`${s.productId}:${s.siteId}`, n(s.estoqueFechado)]));
  const purchaseMap = new Map(purchases.map((p) => [p.id, p]));
  const saleMap = new Map(sales.map((s) => [s.id, s.origem]));
  const userMap = new Map(users.map((u) => [u.id, u.name ?? u.email ?? null]));
  const siteMap = new Map(sites.map((s) => [s.id, s.nome]));

  // ── Saldo após cada movimentação ─────────────────────────────
  // Com filtros/paginação a página não é mais um trecho contíguo do razão, então
  // o "caminhar subtraindo deltas" não fecha. Reconstruímos exato: para cada
  // linha, saldoDepois = saldo atual − Σ deltas de TODAS as movimentações mais
  // recentes do mesmo produto+site (buscadas à parte, sem filtro).
  const saldoPorLinha = new Map<string, number>();
  if (movements.length) {
    const maisAntiga = movements[movements.length - 1].createdAt;
    const stream = await db.stockMovement.findMany({
      where: {
        productId: { in: productIds },
        ...(siteId ? { siteId } : {}),
        createdAt: { gte: maisAntiga },
      },
      select: { id: true, productId: true, siteId: true, deltaFechado: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const pageIds = new Set(movements.map((m) => m.id));
    const somaNovas = new Map<string, number>(); // Σ deltas estritamente mais recentes, por produto:site
    for (const s of stream) {
      const key = `${s.productId}:${s.siteId}`;
      const acima = somaNovas.get(key) ?? 0;
      if (pageIds.has(s.id) && balMap.has(key)) {
        saldoPorLinha.set(s.id, balMap.get(key)! - acima);
      }
      somaNovas.set(key, acima + n(s.deltaFechado));
    }
  }

  const rows: MovimentacaoRow[] = movements.map((m) => {
    const deltaFechado = n(m.deltaFechado);
    const custoUnitario = m.custoUnitario ? n(m.custoUnitario) : null;
    const saldoDepois = saldoPorLinha.has(m.id) ? saldoPorLinha.get(m.id)! : null;

    const purchase = m.purchaseId ? purchaseMap.get(m.purchaseId) : null;
    const producaoNome = m.productionId ? (productionMap.get(m.productionId) ?? null) : null;
    const { origem, documento } = resolveOrigem(m.tipo, {
      purchase,
      transferId: m.transferId,
      saleId: m.saleId,
      saleOrigem: m.saleId ? (saleMap.get(m.saleId) ?? null) : null,
      producaoNome,
      observacao: m.observacao,
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

  return { rows, total, pagina, porPagina, responsaveis };
}

// Descreve a origem em linguagem do operador (não códigos). Os códigos
// (nº pedido, NF, id) ficam em `documento`, exibidos só no painel de detalhes.
function resolveOrigem(
  tipo: string,
  ctx: {
    purchase?: {
      tipo: string;
      motivo: string | null;
      numeroNota: string | null;
      purchaseOrder: { numero: string } | null;
    } | null;
    transferId: string | null;
    saleId: string | null;
    saleOrigem: string | null;
    producaoNome: string | null;
    observacao: string | null;
    delta: number;
  },
): { origem: string; documento: string | null } {
  const { purchase, transferId, saleId, saleOrigem, producaoNome, observacao } = ctx;
  const vendaDoc = saleId ? `Venda #${saleId.slice(-6)}` : null;
  const vendaLabel =
    saleOrigem === "TOTEM"
      ? "Venda no autoatendimento"
      : saleOrigem === "APP"
        ? "Venda pelo app"
        : "Venda no PDV";
  const purchaseDoc = purchase?.purchaseOrder?.numero
    ? purchase.purchaseOrder.numero
    : purchase?.numeroNota
      ? `NF ${purchase.numeroNota}`
      : null;

  switch (tipo) {
    case "ENTRADA":
      if (purchase?.purchaseOrder?.numero) return { origem: "Entrada por pedido de compra", documento: purchaseDoc };
      if (purchase?.motivo === "ESTOQUE_INICIAL") return { origem: "Estoque inicial", documento: purchaseDoc };
      if (purchase?.motivo === "BONIFICACAO") return { origem: "Bonificação", documento: purchaseDoc };
      if (purchase) return { origem: "Entrada compra manual", documento: purchaseDoc };
      return { origem: "Entrada manual", documento: null };
    case "ABERTURA":
      // Garrafa fechada aberta para consumo fracionado (drink/dose) — o
      // fechado vira conteúdo aberto, não é saída de estoque.
      return {
        origem: producaoNome ? `Abertura para ${producaoNome}` : "Abertura de garrafa",
        documento: null,
      };
    case "SAIDA":
      return { origem: saleId ? vendaLabel : "Saída manual", documento: vendaDoc };
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
    case "AJUSTE": {
      // Estorno de venda cancelada carrega o saleId; ajuste de inventário é
      // identificado pela observação gravada no fechamento da contagem.
      if (saleId) return { origem: "Estorno de venda", documento: vendaDoc };
      const inv = observacao?.match(/^Inventário (\S+)/);
      if (inv) return { origem: "Ajuste por inventário", documento: `Inventário ${inv[1]}` };
      return { origem: "Ajuste manual", documento: null };
    }
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

// ── Pedidos de compra (PurchaseOrder) ─────────────────────────

export type PedidoCompraItemView = {
  id: string;
  productId: string;
  nome: string;
  sku: string;
  imagemUrl: string | null;
  packagingId: string | null;
  packagingNome: string | null;
  fatorConversao: number; // un base por unidade de compra (1 = unidade)
  tipo: TipoItemPedido;
  motivoBonificacao: MotivoBonificacao | null;
  qtdPedida: number; // em unidades de compra (embalagem)
  qtdRecebida: number;
  custoUnitario: number; // por unidade de compra (embalagem) — sempre 0 quando tipo != COMPRA
  observacao: string | null;
};

export type PedidoCompraView = {
  id: string;
  numero: string;
  status: string;
  supplierId: string;
  supplierNome: string;
  supplierTelefone: string | null;
  supplierEmail: string | null;
  supplierLogoUrl: string | null;
  siteId: string;
  siteNome: string;
  previsaoEntrega: Date | null;
  valorTotal: number;
  observacao: string | null;
  financeiroGerado: boolean;
  createdAt: Date;
  updatedAt: Date;
  enviadoEm: Date | null;
  confirmadoEm: Date | null;
  emTransitoEm: Date | null;
  recebidoEm: Date | null;
  canceladoEm: Date | null;
  operador: string | null;
  totalItems: number;
  items: PedidoCompraItemView[];
};

export async function loadPedidosCompra(): Promise<PedidoCompraView[]> {
  const pedidos = await db.purchaseOrder.findMany({
    include: {
      supplier: { select: { razaoSocial: true, nomeFantasia: true, telefone: true, email: true, logoUrl: true } },
      site: { select: { nome: true } },
      items: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const productIds = [...new Set(pedidos.flatMap((p) => p.items.map((i) => i.productId)))];
  const packagingIds = [...new Set(pedidos.flatMap((p) => p.items.flatMap((i) => (i.packagingId ? [i.packagingId] : []))))];
  const userIds = [...new Set(pedidos.flatMap((p) => (p.createdBy ? [p.createdBy] : [])))];

  const [products, packagings, users] = await Promise.all([
    mapProdutos(productIds),
    packagingIds.length > 0
      ? db.productPackaging.findMany({ where: { id: { in: packagingIds } }, select: { id: true, nome: true, fatorConversao: true } })
      : Promise.resolve([]),
    // User mora nas tabelas de auth (não tenant-scoped): usa basePrisma.
    userIds.length > 0
      ? basePrisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
  ]);
  const pkgMap = new Map(packagings.map((pk) => [pk.id, { nome: pk.nome, fator: n(pk.fatorConversao) || 1 }]));
  const userMap = new Map(users.map((u) => [u.id, u.name ?? u.email ?? null]));

  return pedidos.map((p) => ({
    id: p.id,
    numero: p.numero,
    status: p.status,
    supplierId: p.supplierId,
    supplierNome: p.supplier ? (p.supplier.nomeFantasia ?? p.supplier.razaoSocial) : "—",
    supplierTelefone: p.supplier?.telefone ?? null,
    supplierEmail: p.supplier?.email ?? null,
    supplierLogoUrl: p.supplier?.logoUrl ?? null,
    siteId: p.siteId,
    siteNome: p.site.nome,
    previsaoEntrega: p.previsaoEntrega,
    valorTotal: n(p.valorTotal),
    observacao: p.observacao,
    financeiroGerado: p.financeiroGerado,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    enviadoEm: p.enviadoEm,
    confirmadoEm: p.confirmadoEm,
    emTransitoEm: p.emTransitoEm,
    recebidoEm: p.recebidoEm,
    canceladoEm: p.canceladoEm,
    operador: p.createdBy ? (userMap.get(p.createdBy) ?? null) : null,
    totalItems: p.items.length,
    items: p.items.map((i) => {
      const pkg = i.packagingId ? (pkgMap.get(i.packagingId) ?? null) : null;
      return {
        id: i.id,
        productId: i.productId,
        nome: products.get(i.productId)?.nome ?? i.productId,
        sku: products.get(i.productId)?.sku ?? "",
        imagemUrl: products.get(i.productId)?.imagemUrl ?? null,
        packagingId: i.packagingId ?? null,
        packagingNome: pkg?.nome ?? null,
        fatorConversao: pkg?.fator ?? 1,
        tipo: i.tipo,
        motivoBonificacao: i.motivoBonificacao ?? null,
        qtdPedida: n(i.qtdPedida),
        qtdRecebida: n(i.qtdRecebida),
        custoUnitario: n(i.custoUnitario),
        observacao: i.observacao ?? null,
      };
    }),
  }));
}

/** Pedidos abertos para conferência/recebimento, opcionalmente do site ativo. */
export async function loadPedidosAReceber(siteId: string | null): Promise<PedidoCompraView[]> {
  const all = await loadPedidosCompra();
  return all.filter(
    (p) =>
      ["ENVIADO", "AGUARDANDO", "EM_TRANSITO", "RECEBIDO_PARCIAL"].includes(p.status) &&
      (!siteId || p.siteId === siteId),
  );
}

export async function loadComprasFormOptions() {
  const [suppliers, products, sites, entradas, pendentes] = await Promise.all([
    db.supplier.findMany({ where: { ativo: true }, orderBy: { razaoSocial: "asc" }, select: { id: true, razaoSocial: true, nomeFantasia: true, telefone: true, email: true, pedidoMinimo: true } }),
    db.product.findMany({
      where: { ativo: true, tipo: { in: ["SIMPLES", "INSUMO"] } },
      orderBy: { nome: "asc" },
      select: {
        id: true,
        nome: true,
        sku: true,
        ean: true,
        imagemUrl: true,
        custoMedio: true,
        subcategory: { select: { nome: true } },
        packagings: { select: { id: true, nome: true, fatorConversao: true, isCompraDefault: true } },
        suppliers: { select: { supplierId: true } },
        stocks: { select: { siteId: true, estoqueFechado: true, estoqueAberto: true } },
      },
    }),
    db.site.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true, tipo: true } }),
    // Último preço pago por produto×fornecedor — entradas de compra (custoUnitario
    // já é por UN base). Join manual com Purchase (StockMovement não tem relation).
    db.stockMovement.findMany({
      where: { tipo: "ENTRADA", purchaseId: { not: null }, custoUnitario: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 3000,
      select: { productId: true, purchaseId: true, custoUnitario: true, createdAt: true },
    }),
    // Itens já pedidos e não recebidos — aviso de duplicidade no form.
    db.purchaseOrderItem.findMany({
      where: { purchaseOrder: { status: { in: ["ENVIADO", "AGUARDANDO", "EM_TRANSITO", "RECEBIDO_PARCIAL"] } } },
      select: {
        productId: true,
        packagingId: true,
        qtdPedida: true,
        qtdRecebida: true,
        purchaseOrder: { select: { id: true, numero: true, supplierId: true } },
      },
    }),
  ]);

  // Resolve fornecedor das entradas via Purchase.
  const entradaPurchaseIds = [...new Set(entradas.flatMap((e) => (e.purchaseId ? [e.purchaseId] : [])))];
  const entradaPurchases = entradaPurchaseIds.length
    ? await db.purchase.findMany({ where: { id: { in: entradaPurchaseIds } }, select: { id: true, supplierId: true } })
    : [];
  const purchaseSupplier = new Map(entradaPurchases.map((p) => [p.id, p.supplierId]));

  // productId → últimos preços (1 por fornecedor, mais recente primeiro).
  const ultimosPrecos = new Map<string, { supplierId: string | null; custoUnBase: number; em: string }[]>();
  for (const e of entradas) {
    const supplierId = e.purchaseId ? (purchaseSupplier.get(e.purchaseId) ?? null) : null;
    const lista = ultimosPrecos.get(e.productId) ?? [];
    if (lista.some((u) => u.supplierId === supplierId)) continue; // já tem o mais recente (query vem desc)
    lista.push({ supplierId, custoUnBase: n(e.custoUnitario), em: e.createdAt.toISOString() });
    ultimosPrecos.set(e.productId, lista);
  }

  // productId → pedidos abertos com o item (restante > 0).
  const pendPkgIds = [...new Set(pendentes.flatMap((p) => (p.packagingId ? [p.packagingId] : [])))];
  const pendPkgs = pendPkgIds.length
    ? await db.productPackaging.findMany({ where: { id: { in: pendPkgIds } }, select: { id: true, nome: true } })
    : [];
  const pendPkgNome = new Map(pendPkgs.map((pk) => [pk.id, pk.nome]));
  const pendentesMap = new Map<string, { poId: string; numero: string; supplierId: string; qtd: number; packagingNome: string | null }[]>();
  for (const p of pendentes) {
    const rest = n(p.qtdPedida) - n(p.qtdRecebida);
    if (rest <= 0) continue;
    const lista = pendentesMap.get(p.productId) ?? [];
    lista.push({
      poId: p.purchaseOrder.id,
      numero: p.purchaseOrder.numero,
      supplierId: p.purchaseOrder.supplierId,
      qtd: rest,
      packagingNome: p.packagingId ? (pendPkgNome.get(p.packagingId) ?? null) : null,
    });
    pendentesMap.set(p.productId, lista);
  }

  return {
    suppliers: suppliers.map((s) => ({
      id: s.id,
      razaoSocial: s.razaoSocial,
      nomeFantasia: s.nomeFantasia,
      telefone: s.telefone,
      email: s.email,
      pedidoMinimo: s.pedidoMinimo != null ? n(s.pedidoMinimo) : null,
    })),
    sites,
    products: products.map((p) => ({
      id: p.id,
      nome: p.nome,
      sku: p.sku,
      ean: p.ean,
      imagemUrl: p.imagemUrl,
      custoMedio: p.custoMedio ? n(p.custoMedio) : null,
      categoria: p.subcategory?.nome ?? null,
      supplierIds: p.suppliers.map((s) => s.supplierId),
      // UN base disponíveis por site (fechado + aberto) — decisão de qtd no form.
      estoquePorSite: Object.fromEntries(
        p.stocks.filter((s) => s.siteId).map((s) => [s.siteId as string, n(s.estoqueFechado) + n(s.estoqueAberto)]),
      ) as Record<string, number>,
      ultimosPrecos: ultimosPrecos.get(p.id) ?? [],
      pendentes: pendentesMap.get(p.id) ?? [],
      packagings: p.packagings.map((pk) => ({
        id: pk.id,
        nome: pk.nome,
        fatorConversao: Number(pk.fatorConversao),
        isCompraDefault: pk.isCompraDefault,
      })),
    })),
  };
}

// ── Form options for entrada ──────────────────────────────────

export async function loadEntradaFormOptions() {
  // Select enxuto: só os campos que o NovaEntradaForm consome.
  const [products, sites] = await Promise.all([
    db.product.findMany({
      where: { ativo: true, tipo: { in: ["SIMPLES", "INSUMO"] } },
      select: {
        id: true,
        nome: true,
        sku: true,
        ean: true,
        imagemUrl: true,
        packagings: { select: { id: true, nome: true, fatorConversao: true, isCompraDefault: true } },
        brand: { select: { nome: true } },
      },
      orderBy: { nome: "asc" },
    }),
    db.site.findMany({
      where: { ativo: true },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true, tipo: true },
    }),
  ]);

  return { products, sites };
}

// ── Reposição ─────────────────────────────────────────────────

export async function loadReposicao(siteId: string | null): Promise<ReposicaoRow[]> {
  const stocks = await db.stock.findMany({
    where: {
      ...(siteId ? { siteId } : {}),
      product: { controlaEstoque: true },
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

/** Opções para o formulário de transferência: sites, produtos estocáveis e saldos por site. */
export async function loadTransferenciaFormOptions() {
  const [sites, products, stocks] = await Promise.all([
    loadSitesTransferencia(),
    db.product.findMany({
      where: { ativo: true, tipo: { in: ["SIMPLES", "INSUMO"] } },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true, sku: true },
    }),
    db.stock.findMany({
      where: { estoqueFechado: { gt: 0 } },
      select: { productId: true, siteId: true, estoqueFechado: true },
    }),
  ]);
  return {
    sites,
    products,
    saldos: stocks.map((s) => ({
      productId: s.productId,
      siteId: s.siteId ?? "",
      saldo: n(s.estoqueFechado),
    })),
  };
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

/** Helper: mapa productId -> {nome, sku, ean, imagemUrl} para um conjunto de ids. */
async function mapProdutos(productIds: string[]) {
  if (productIds.length === 0)
    return new Map<string, { nome: string; sku: string; ean: string | null; imagemUrl: string | null }>();
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, nome: true, sku: true, ean: true, imagemUrl: true },
  });
  return new Map(products.map((p) => [p.id, { nome: p.nome, sku: p.sku, ean: p.ean, imagemUrl: p.imagemUrl }]));
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
  ean: string | null;
  imagemUrl: string | null;
  locationNome: string | null;
  qtdSistema: number;
  qtdContada: number | null;
};

export type InventarioView = {
  id: string;
  status: string;
  siteId: string;
  siteNome: string;
  escopoTipo: string;
  escopoLabel: string;
  categoriaNome: string | null;
  qtdProdutos: number;
  modoCego: boolean;
  dataProgramada: Date;
  recorrente: boolean;
  diasSemana: number[];
  observacao: string | null;
  createdAt: Date;
  iniciadoEm: Date | null;
  fechadoEm: Date | null;
  fechadoPorNome: string | null;
  items: InventarioItemView[];
};

export async function loadInventarios(siteId: string | null): Promise<InventarioView[]> {
  const invs = await db.inventory.findMany({
    where: siteId ? { siteId } : {},
    include: {
      site: { select: { nome: true } },
      category: { select: { nome: true } },
      items: { select: { productId: true, qtdSistema: true, qtdContada: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const productIds = [...new Set(invs.flatMap((i) => i.items.map((it) => it.productId)))];
  const siteIds = [...new Set(invs.map((i) => i.siteId))];
  const fechadoPorIds = [...new Set(invs.map((i) => i.fechadoPor).filter((v): v is string => !!v))];

  // Inventários ainda não iniciados (sem InventoryItem) precisam do tamanho do escopo
  // calculado agora: categoria conta produtos da categoria; completo conta produtos com
  // estoque no site.
  const semItens = invs.filter((i) => i.items.length === 0);
  const categoriaIds = [...new Set(semItens.filter((i) => i.escopoTipo === "CATEGORIA" && i.categoryId).map((i) => i.categoryId!))];
  const sitesCompleto = [...new Set(semItens.filter((i) => i.escopoTipo === "COMPLETO").map((i) => i.siteId))];

  const [prodMap, stocks, produtosCategoria, produtosCompleto, fechadoPorUsers] = await Promise.all([
    mapProdutos(productIds),
    productIds.length > 0
      ? db.stock.findMany({
          where: { productId: { in: productIds }, siteId: { in: siteIds } },
          select: { productId: true, siteId: true, location: { select: { nome: true } } },
        })
      : Promise.resolve([]),
    categoriaIds.length > 0
      ? db.product.findMany({
          where: { subcategory: { categoryId: { in: categoriaIds } } },
          select: { id: true, subcategory: { select: { categoryId: true } } },
        })
      : Promise.resolve([]),
    sitesCompleto.length > 0
      ? db.stock.findMany({
          where: { siteId: { in: sitesCompleto } },
          distinct: ["productId", "siteId"],
          select: { productId: true, siteId: true },
        })
      : Promise.resolve([]),
    // User mora nas tabelas de auth (não tenant-scoped): usa basePrisma.
    fechadoPorIds.length > 0
      ? basePrisma.user.findMany({ where: { id: { in: fechadoPorIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
  ]);
  const locationMap = new Map(stocks.map((s) => [`${s.productId}:${s.siteId}`, s.location?.nome ?? null]));
  const fechadoPorMap = new Map(fechadoPorUsers.map((u) => [u.id, u.name ?? u.email ?? null]));

  const qtdPorCategoria = new Map<string, number>();
  for (const p of produtosCategoria) {
    const catId = p.subcategory?.categoryId;
    if (!catId) continue;
    qtdPorCategoria.set(catId, (qtdPorCategoria.get(catId) ?? 0) + 1);
  }
  const qtdPorSite = new Map<string, number>();
  for (const s of produtosCompleto) {
    qtdPorSite.set(s.siteId!, (qtdPorSite.get(s.siteId!) ?? 0) + 1);
  }

  return invs.map((inv) => {
    // Antes de iniciar, o escopo ainda não tem InventoryItem — resolve pelo tamanho do escopo.
    const qtdProdutos =
      inv.items.length > 0
        ? inv.items.length
        : inv.escopoTipo === "PRODUTOS"
          ? inv.escopoProdutoIds.length
          : inv.escopoTipo === "CATEGORIA"
            ? (inv.categoryId ? qtdPorCategoria.get(inv.categoryId) ?? 0 : 0)
            : qtdPorSite.get(inv.siteId) ?? 0;
    return {
      id: inv.id,
      status: inv.status,
      siteId: inv.siteId,
      siteNome: inv.site.nome,
      escopoTipo: inv.escopoTipo,
      escopoLabel:
        inv.escopoTipo === "CATEGORIA"
          ? `Categoria: ${inv.category?.nome ?? "—"}`
          : inv.escopoTipo === "PRODUTOS"
            ? `${qtdProdutos} ${qtdProdutos === 1 ? "produto" : "produtos"}`
            : "Todo o estoque",
      categoriaNome: inv.category?.nome ?? null,
      qtdProdutos,
      modoCego: inv.modoCego,
      dataProgramada: inv.dataProgramada,
      recorrente: inv.recorrente,
      diasSemana: inv.diasSemana,
      observacao: inv.observacao,
      createdAt: inv.createdAt,
      iniciadoEm: inv.iniciadoEm,
      fechadoEm: inv.fechadoEm,
      fechadoPorNome: inv.fechadoPor ? fechadoPorMap.get(inv.fechadoPor) ?? null : null,
      items: inv.items.map((it) => ({
        productId: it.productId,
        nome: prodMap.get(it.productId)?.nome ?? it.productId,
        sku: prodMap.get(it.productId)?.sku ?? "",
        ean: prodMap.get(it.productId)?.ean ?? null,
        imagemUrl: prodMap.get(it.productId)?.imagemUrl ?? null,
        locationNome: locationMap.get(`${it.productId}:${inv.siteId}`) ?? null,
        // Contagem cega em andamento: o saldo do sistema não pode chegar ao
        // browser (nem via devtools) — só é revelado após o fechamento.
        qtdSistema: inv.modoCego && inv.status === "ABERTO" ? 0 : n(it.qtdSistema),
        qtdContada: it.qtdContada != null ? n(it.qtdContada) : null,
      })),
    };
  });
}

/** Categorias para o formulário de inventário — leve, carregada de cara com a página. */
export async function loadInventarioCategorias() {
  return db.category.findMany({
    orderBy: { nome: "asc" },
    select: { id: true, nome: true },
  });
}

/**
 * Produtos para o escopo "Produtos específicos" do formulário de inventário.
 * Catálogo inteiro — carregado sob demanda (só quando o usuário abre o formulário),
 * não no load inicial da página.
 */
export async function loadInventarioFormOptions() {
  const [categories, products] = await Promise.all([
    loadInventarioCategorias(),
    db.product.findMany({
      where: { ativo: true, tipo: { in: ["SIMPLES", "INSUMO"] } },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true, sku: true },
    }),
  ]);
  return { categories, products };
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
