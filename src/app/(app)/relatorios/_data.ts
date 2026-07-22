import "server-only";
import { cache } from "react";
import { db } from "@/lib/prisma";

/**
 * Camada de dados dos relatórios (PRD Fase 7 §4/§5). Tudo é LEITURA agregada
 * sobre os dados das Fases 1-5, dentro do contexto de tenant (via `db`). Sem
 * mutação. Os índices já são liderados por tenantId; toda query filtra por
 * período + (opcional) site.
 *
 * CMV/COGS sai dos MOVIMENTOS: cada StockMovement(SAIDA|PRODUCAO) com saleId
 * carrega custoUnitario; somá-los dá o custo da venda sem refazer ficha técnica.
 * O aberto (ml/g) é convertido em fração de unidade via conteudoPorUnidade.
 */

const n = (v: unknown): number => (v == null ? 0 : Number(v));

export type Range = { inicio: Date; fim: Date };

type SiteFilter = string | null;

function saleWhere(range: Range, siteId: SiteFilter) {
  return {
    status: "PAGA" as const,
    paidAt: { gte: range.inicio, lt: range.fim },
    ...(siteId ? { siteId } : {}),
  };
}

// ── CMV (custo da mercadoria vendida) ───────────────────────

/** Mapa productId → conteudoPorUnidade (p/ converter consumo aberto em unidades). */
async function conteudoMap(productIds: string[]): Promise<Map<string, number | null>> {
  if (productIds.length === 0) return new Map();
  const prods = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, conteudoPorUnidade: true },
  });
  return new Map(prods.map((p) => [p.id, p.conteudoPorUnidade ? n(p.conteudoPorUnidade) : null]));
}

/** CMV do período: Σ custoUnitario × |delta| dos movimentos de venda. */
async function cmvRange(range: Range, siteId: SiteFilter): Promise<number> {
  const movs = await db.stockMovement.findMany({
    where: {
      tipo: { in: ["SAIDA", "PRODUCAO"] },
      saleId: { not: null },
      createdAt: { gte: range.inicio, lt: range.fim },
      ...(siteId ? { siteId } : {}),
    },
    select: { productId: true, deltaFechado: true, deltaAberto: true, custoUnitario: true },
  });
  if (movs.length === 0) return 0;
  const conteudo = await conteudoMap([...new Set(movs.map((m) => m.productId))]);

  let cmv = 0;
  for (const m of movs) {
    const cu = m.custoUnitario != null ? n(m.custoUnitario) : 0;
    if (cu === 0) continue;
    const cpu = conteudo.get(m.productId);
    const unidadesAbertas = cpu && cpu > 0 ? Math.abs(n(m.deltaAberto)) / cpu : 0;
    cmv += cu * (Math.abs(n(m.deltaFechado)) + unidadesAbertas);
  }
  return Math.round(cmv * 100) / 100;
}

// ── Resumo de vendas (faturamento, ticket, CMV, margem) ─────

export type ResumoVendas = {
  faturamento: number;
  numVendas: number;
  ticket: number;
  cmv: number;
  margemBruta: number;
  margemPct: number; // 0-100
};

export async function resumoVendas(range: Range, siteId: SiteFilter): Promise<ResumoVendas> {
  const [agg, cmv] = await Promise.all([
    db.sale.aggregate({ where: saleWhere(range, siteId), _sum: { total: true }, _count: true }),
    cmvRange(range, siteId),
  ]);
  const faturamento = n(agg._sum.total);
  const numVendas = agg._count;
  const margemBruta = faturamento - cmv;
  return {
    faturamento,
    numVendas,
    ticket: numVendas > 0 ? faturamento / numVendas : 0,
    cmv,
    margemBruta,
    margemPct: faturamento > 0 ? (margemBruta / faturamento) * 100 : 0,
  };
}

// ── Mix de pagamento ────────────────────────────────────────

export type MixPagamento = { metodo: string; valor: number; numVendas: number };

export async function mixPagamento(range: Range, siteId: SiteFilter): Promise<MixPagamento[]> {
  const grupos = await db.payment.groupBy({
    by: ["metodo"],
    where: {
      status: "CONFIRMADO",
      sale: { is: saleWhere(range, siteId) },
    },
    _sum: { valor: true },
    _count: true,
  });
  return grupos
    .map((g) => ({ metodo: g.metodo as string, valor: n(g._sum.valor), numVendas: g._count }))
    .filter((g) => g.valor > 0)
    .sort((a, b) => b.valor - a.valor);
}

// ── Vendas por dia (tendência) ──────────────────────────────

export type PontoTempo = { data: string; valor: number };

export async function vendasPorDia(range: Range, siteId: SiteFilter): Promise<PontoTempo[]> {
  const sales = await db.sale.findMany({
    where: saleWhere(range, siteId),
    select: { paidAt: true, total: true },
  });
  const porDia = new Map<string, number>();
  // pré-popula dias do intervalo (evita buracos no gráfico)
  for (let d = new Date(range.inicio); d < range.fim; d = new Date(d.getTime() + 86400000)) {
    porDia.set(chaveDia(d), 0);
  }
  for (const s of sales) {
    if (!s.paidAt) continue;
    const k = chaveDia(s.paidAt);
    porDia.set(k, (porDia.get(k) ?? 0) + n(s.total));
  }
  return [...porDia.entries()].map(([data, valor]) => ({ data, valor }));
}

function chaveDia(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Série financeira diária (receita, lucro, ticket, nº vendas) ─────

export type PontoFinanceiro = {
  data: string; // YYYY-MM-DD
  receita: number;
  cmv: number;
  lucro: number;
  numVendas: number;
  ticket: number;
};

/** Série diária completa — base do gráfico principal do dashboard (troca de métrica sem refetch). */
export async function serieFinanceiraDiaria(range: Range, siteId: SiteFilter): Promise<PontoFinanceiro[]> {
  const [sales, movs] = await Promise.all([
    db.sale.findMany({ where: saleWhere(range, siteId), select: { paidAt: true, total: true } }),
    db.stockMovement.findMany({
      where: {
        tipo: { in: ["SAIDA", "PRODUCAO"] },
        saleId: { not: null },
        createdAt: { gte: range.inicio, lt: range.fim },
        ...(siteId ? { siteId } : {}),
      },
      select: { productId: true, deltaFechado: true, deltaAberto: true, custoUnitario: true, createdAt: true },
    }),
  ]);
  const conteudo = await conteudoMap([...new Set(movs.map((m) => m.productId))]);

  const porDia = new Map<string, { receita: number; cmv: number; numVendas: number }>();
  for (let d = new Date(range.inicio); d < range.fim; d = new Date(d.getTime() + 86400000)) {
    porDia.set(chaveDia(d), { receita: 0, cmv: 0, numVendas: 0 });
  }
  for (const s of sales) {
    if (!s.paidAt) continue;
    const k = chaveDia(s.paidAt);
    const cur = porDia.get(k) ?? { receita: 0, cmv: 0, numVendas: 0 };
    cur.receita += n(s.total);
    cur.numVendas += 1;
    porDia.set(k, cur);
  }
  for (const m of movs) {
    const cu = m.custoUnitario != null ? n(m.custoUnitario) : 0;
    if (cu === 0) continue;
    const k = chaveDia(m.createdAt);
    const cur = porDia.get(k) ?? { receita: 0, cmv: 0, numVendas: 0 };
    const cpu = conteudo.get(m.productId);
    const unidadesAbertas = cpu && cpu > 0 ? Math.abs(n(m.deltaAberto)) / cpu : 0;
    cur.cmv += cu * (Math.abs(n(m.deltaFechado)) + unidadesAbertas);
    porDia.set(k, cur);
  }

  return [...porDia.entries()].map(([data, v]) => {
    const lucro = v.receita - v.cmv;
    return {
      data,
      receita: Math.round(v.receita * 100) / 100,
      cmv: Math.round(v.cmv * 100) / 100,
      lucro: Math.round(lucro * 100) / 100,
      numVendas: v.numVendas,
      ticket: v.numVendas > 0 ? Math.round((v.receita / v.numVendas) * 100) / 100 : 0,
    };
  });
}

// ── Vendas por origem / hora ────────────────────────────────

export async function vendasPorHora(range: Range, siteId: SiteFilter): Promise<PontoTempo[]> {
  const sales = await db.sale.findMany({
    where: saleWhere(range, siteId),
    select: { paidAt: true, total: true },
  });
  const horas = new Map<number, number>();
  for (let h = 0; h < 24; h++) horas.set(h, 0);
  for (const s of sales) {
    if (!s.paidAt) continue;
    horas.set(s.paidAt.getHours(), (horas.get(s.paidAt.getHours()) ?? 0) + n(s.total));
  }
  return [...horas.entries()].map(([h, valor]) => ({ data: `${String(h).padStart(2, "0")}h`, valor }));
}

// ── Ranking de produtos (vendas, margem, ABC) ───────────────

export type ProdutoVendaAgg = {
  productId: string;
  nome: string;
  sku: string;
  categoria: string | null;
  imagemUrl: string | null;
  quantidade: number;
  receita: number;
  custo: number;
  margem: number;
  margemPct: number;
};

/**
 * Agregação por produto: receita (SaleItem), custo (movimentos), margem.
 *
 * Memoizado por request (`cache`): é a leitura mais cara e mais reaproveitada —
 * `vendasPorCategoria`, `crescimentoProdutos` e `categoriasComparativo` todas
 * derivam dela, e o dashboard chegava a rodá-la 6× no mesmo render. A chave é a
 * identidade dos argumentos, então quem quiser o reuso passa o MESMO objeto
 * `Range` adiante (é o que o /inicio faz, ver `_sections.tsx`).
 */
export const rankingProdutos = cache(rankingProdutosRaw);

async function rankingProdutosRaw(range: Range, siteId: SiteFilter): Promise<ProdutoVendaAgg[]> {
  const [itens, movs] = await Promise.all([
    db.saleItem.groupBy({
      by: ["productId"],
      where: { sale: { is: saleWhere(range, siteId) } },
      _sum: { total: true, quantidade: true },
    }),
    db.stockMovement.findMany({
      where: {
        tipo: { in: ["SAIDA", "PRODUCAO"] },
        saleId: { not: null },
        createdAt: { gte: range.inicio, lt: range.fim },
        ...(siteId ? { siteId } : {}),
      },
      select: { productId: true, deltaFechado: true, deltaAberto: true, custoUnitario: true },
    }),
  ]);
  if (itens.length === 0) return [];

  // Custo por produto (mesma conversão do CMV global).
  const conteudo = await conteudoMap([...new Set(movs.map((m) => m.productId))]);
  const custoPorProduto = new Map<string, number>();
  for (const m of movs) {
    const cu = m.custoUnitario != null ? n(m.custoUnitario) : 0;
    if (cu === 0) continue;
    const cpu = conteudo.get(m.productId);
    const unidadesAbertas = cpu && cpu > 0 ? Math.abs(n(m.deltaAberto)) / cpu : 0;
    const add = cu * (Math.abs(n(m.deltaFechado)) + unidadesAbertas);
    custoPorProduto.set(m.productId, (custoPorProduto.get(m.productId) ?? 0) + add);
  }

  const productIds = itens.map((i) => i.productId);
  const prods = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, nome: true, sku: true, imagemUrl: true, subcategory: { select: { category: { select: { nome: true } } } } },
  });
  const prodMap = new Map(prods.map((p) => [p.id, p]));

  return itens
    .map((i) => {
      const p = prodMap.get(i.productId);
      const receita = n(i._sum.total);
      const custo = Math.round((custoPorProduto.get(i.productId) ?? 0) * 100) / 100;
      const margem = receita - custo;
      return {
        productId: i.productId,
        nome: p?.nome ?? i.productId,
        sku: p?.sku ?? "",
        categoria: p?.subcategory?.category?.nome ?? null,
        imagemUrl: p?.imagemUrl ?? null,
        quantidade: n(i._sum.quantidade),
        receita,
        custo,
        margem,
        margemPct: receita > 0 ? (margem / receita) * 100 : 0,
      };
    })
    .sort((a, b) => b.receita - a.receita);
}

// ── Vendas por categoria ────────────────────────────────────

export type CategoriaAgg = { categoria: string; receita: number; quantidade: number; custo: number; margem: number };

export async function vendasPorCategoria(range: Range, siteId: SiteFilter): Promise<CategoriaAgg[]> {
  const ranking = await rankingProdutos(range, siteId);
  const map = new Map<string, CategoriaAgg>();
  for (const p of ranking) {
    const cat = p.categoria ?? "Sem categoria";
    const cur = map.get(cat) ?? { categoria: cat, receita: 0, quantidade: 0, custo: 0, margem: 0 };
    cur.receita += p.receita;
    cur.quantidade += p.quantidade;
    cur.custo += p.custo;
    cur.margem += p.margem;
    map.set(cat, cur);
  }
  return [...map.values()].sort((a, b) => b.receita - a.receita);
}

// ── Curva ABC ───────────────────────────────────────────────

export type ItemABC = ProdutoVendaAgg & {
  classe: "A" | "B" | "C";
  acumuladoPct: number; // % acumulado do faturamento
};

/** Curva ABC por faturamento (A≤80%, B≤95%, C resto). */
export async function curvaABC(range: Range, siteId: SiteFilter): Promise<ItemABC[]> {
  const ranking = await rankingProdutos(range, siteId);
  const total = ranking.reduce((s, p) => s + p.receita, 0);
  if (total <= 0) return [];
  let acc = 0;
  return ranking.map((p) => {
    acc += p.receita;
    const acumuladoPct = (acc / total) * 100;
    const classe: "A" | "B" | "C" = acumuladoPct <= 80 ? "A" : acumuladoPct <= 95 ? "B" : "C";
    return { ...p, classe, acumuladoPct };
  });
}

// ── Estoque: ruptura, valor, giro ───────────────────────────

export type RupturaRow = {
  productId: string;
  nome: string;
  sku: string;
  siteNome: string;
  estoqueFechado: number;
  estoqueMinimo: number;
  estoqueIdeal: number;
  deficit: number;
};

export async function ruptura(siteId: SiteFilter): Promise<RupturaRow[]> {
  const stocks = await db.stock.findMany({
    where: siteId ? { siteId } : {},
    select: {
      productId: true,
      estoqueFechado: true,
      estoqueMinimo: true,
      estoqueIdeal: true,
      product: { select: { nome: true, sku: true } },
      site: { select: { nome: true } },
    },
  });
  return stocks
    .filter((s) => n(s.estoqueFechado) < n(s.estoqueMinimo))
    .map((s) => ({
      productId: s.productId,
      nome: s.product.nome,
      sku: s.product.sku,
      siteNome: s.site?.nome ?? "—",
      estoqueFechado: n(s.estoqueFechado),
      estoqueMinimo: n(s.estoqueMinimo),
      estoqueIdeal: n(s.estoqueIdeal),
      deficit: n(s.estoqueIdeal) - n(s.estoqueFechado),
    }))
    .sort((a, b) => b.deficit - a.deficit);
}

/** Valor de estoque ATUAL (live), somando saldo × custoMedio por produto×site. */
export async function valorEstoqueAtual(siteId: SiteFilter): Promise<number> {
  const stocks = await db.stock.findMany({
    where: siteId ? { siteId } : {},
    select: {
      estoqueFechado: true,
      estoqueAberto: true,
      product: { select: { custoMedio: true, conteudoPorUnidade: true } },
    },
  });
  let total = 0;
  for (const s of stocks) {
    const cm = s.product.custoMedio != null ? n(s.product.custoMedio) : 0;
    if (cm === 0) continue;
    const cpu = s.product.conteudoPorUnidade ? n(s.product.conteudoPorUnidade) : null;
    const abertas = cpu && cpu > 0 ? n(s.estoqueAberto) / cpu : 0;
    total += (n(s.estoqueFechado) + abertas) * cm;
  }
  return Math.round(total * 100) / 100;
}

/** Valor médio de estoque no período (via snapshots). null se sem histórico. */
async function valorMedioEstoque(range: Range, siteId: SiteFilter): Promise<number | null> {
  const snaps = await db.stockSnapshot.groupBy({
    by: ["data"],
    where: { data: { gte: range.inicio, lt: range.fim }, ...(siteId ? { siteId } : {}) },
    _sum: { valorEstoque: true },
  });
  if (snaps.length === 0) return null;
  const soma = snaps.reduce((s, d) => s + n(d._sum.valorEstoque), 0);
  return soma / snaps.length;
}

/** Giro de estoque = CMV do período ÷ valor médio de estoque. null sem snapshot. */
export async function giroEstoque(range: Range, siteId: SiteFilter): Promise<number | null> {
  const [cmv, valorMedio] = await Promise.all([cmvRange(range, siteId), valorMedioEstoque(range, siteId)]);
  if (valorMedio == null || valorMedio <= 0) return null;
  return Math.round((cmv / valorMedio) * 100) / 100;
}

export type PosicaoEstoqueRow = {
  productId: string;
  nome: string;
  sku: string;
  siteNome: string;
  estoqueFechado: number;
  estoqueAberto: number;
  custoMedio: number | null;
  valorEstoque: number;
  abaixoMinimo: boolean;
};

export async function posicaoEstoque(siteId: SiteFilter): Promise<PosicaoEstoqueRow[]> {
  const stocks = await db.stock.findMany({
    where: siteId ? { siteId } : {},
    select: {
      productId: true,
      estoqueFechado: true,
      estoqueAberto: true,
      estoqueMinimo: true,
      product: { select: { nome: true, sku: true, custoMedio: true, conteudoPorUnidade: true } },
      site: { select: { nome: true } },
    },
    orderBy: { product: { nome: "asc" } },
  });
  return stocks.map((s) => {
    const cm = s.product.custoMedio != null ? n(s.product.custoMedio) : null;
    const cpu = s.product.conteudoPorUnidade ? n(s.product.conteudoPorUnidade) : null;
    const abertas = cpu && cpu > 0 ? n(s.estoqueAberto) / cpu : 0;
    return {
      productId: s.productId,
      nome: s.product.nome,
      sku: s.product.sku,
      siteNome: s.site?.nome ?? "—",
      estoqueFechado: n(s.estoqueFechado),
      estoqueAberto: n(s.estoqueAberto),
      custoMedio: cm,
      valorEstoque: cm != null ? Math.round((n(s.estoqueFechado) + abertas) * cm * 100) / 100 : 0,
      abaixoMinimo: n(s.estoqueFechado) < n(s.estoqueMinimo),
    };
  });
}

// ── Perdas ──────────────────────────────────────────────────

export type PerdaRow = {
  productId: string;
  nome: string;
  sku: string;
  quantidade: number;
  custo: number;
};

export type ResumoPerdas = { total: number; itens: PerdaRow[] };

export async function perdas(range: Range, siteId: SiteFilter): Promise<ResumoPerdas> {
  const movs = await db.stockMovement.findMany({
    where: {
      tipo: "PERDA",
      createdAt: { gte: range.inicio, lt: range.fim },
      ...(siteId ? { siteId } : {}),
    },
    select: { productId: true, deltaFechado: true, deltaAberto: true, custoUnitario: true },
  });
  if (movs.length === 0) return { total: 0, itens: [] };
  const conteudo = await conteudoMap([...new Set(movs.map((m) => m.productId))]);

  const agg = new Map<string, { quantidade: number; custo: number }>();
  for (const m of movs) {
    const cu = m.custoUnitario != null ? n(m.custoUnitario) : 0;
    const cpu = conteudo.get(m.productId);
    const abertas = cpu && cpu > 0 ? Math.abs(n(m.deltaAberto)) / cpu : 0;
    const qtd = Math.abs(n(m.deltaFechado)) + abertas;
    const cur = agg.get(m.productId) ?? { quantidade: 0, custo: 0 };
    cur.quantidade += qtd;
    cur.custo += cu * qtd;
    agg.set(m.productId, cur);
  }

  const prods = await db.product.findMany({
    where: { id: { in: [...agg.keys()] } },
    select: { id: true, nome: true, sku: true },
  });
  const prodMap = new Map(prods.map((p) => [p.id, p]));

  const itens = [...agg.entries()]
    .map(([productId, v]) => ({
      productId,
      nome: prodMap.get(productId)?.nome ?? productId,
      sku: prodMap.get(productId)?.sku ?? "",
      quantidade: Math.round(v.quantidade * 1000) / 1000,
      custo: Math.round(v.custo * 100) / 100,
    }))
    .sort((a, b) => b.custo - a.custo);

  return { total: itens.reduce((s, i) => s + i.custo, 0), itens };
}

// ── Compras ─────────────────────────────────────────────────

export type CompraFornecedorAgg = { supplierNome: string; total: number; numNotas: number };

export async function comprasPorFornecedor(range: Range, siteId: SiteFilter): Promise<CompraFornecedorAgg[]> {
  const purchases = await db.purchase.findMany({
    where: { data: { gte: range.inicio, lt: range.fim }, ...(siteId ? { siteId } : {}) },
    select: {
      supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      items: { select: { custoTotal: true } },
    },
  });
  const map = new Map<string, CompraFornecedorAgg>();
  for (const p of purchases) {
    const nome = p.supplier ? (p.supplier.nomeFantasia ?? p.supplier.razaoSocial) : "Entrada manual";
    const total = p.items.reduce((s, i) => s + n(i.custoTotal), 0);
    const cur = map.get(nome) ?? { supplierNome: nome, total: 0, numNotas: 0 };
    cur.total += total;
    cur.numNotas += 1;
    map.set(nome, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export type CompraProdutoAgg = {
  productId: string;
  nome: string;
  sku: string;
  quantidade: number;
  total: number;
  custoMedioCompra: number;
};

export async function comprasPorProduto(range: Range, siteId: SiteFilter): Promise<CompraProdutoAgg[]> {
  const items = await db.purchaseItem.findMany({
    where: { purchase: { is: { data: { gte: range.inicio, lt: range.fim }, ...(siteId ? { siteId } : {}) } } },
    select: { productId: true, quantidade: true, custoTotal: true, packagingId: true },
  });
  if (items.length === 0) return [];

  // converte nº de embalagens → unidades base via fatorConversao
  const pkgIds = [...new Set(items.flatMap((i) => (i.packagingId ? [i.packagingId] : [])))];
  const pkgs = pkgIds.length
    ? await db.productPackaging.findMany({ where: { id: { in: pkgIds } }, select: { id: true, fatorConversao: true } })
    : [];
  const pkgMap = new Map(pkgs.map((p) => [p.id, n(p.fatorConversao)]));

  const agg = new Map<string, { quantidade: number; total: number }>();
  for (const i of items) {
    const fator = i.packagingId ? (pkgMap.get(i.packagingId) ?? 1) : 1;
    const unidades = n(i.quantidade) * fator;
    const cur = agg.get(i.productId) ?? { quantidade: 0, total: 0 };
    cur.quantidade += unidades;
    cur.total += n(i.custoTotal);
    agg.set(i.productId, cur);
  }

  const prods = await db.product.findMany({
    where: { id: { in: [...agg.keys()] } },
    select: { id: true, nome: true, sku: true },
  });
  const prodMap = new Map(prods.map((p) => [p.id, p]));

  return [...agg.entries()]
    .map(([productId, v]) => ({
      productId,
      nome: prodMap.get(productId)?.nome ?? productId,
      sku: prodMap.get(productId)?.sku ?? "",
      quantidade: Math.round(v.quantidade * 1000) / 1000,
      total: Math.round(v.total * 100) / 100,
      custoMedioCompra: v.quantidade > 0 ? Math.round((v.total / v.quantidade) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

// ── Produção / rentabilidade de drink ───────────────────────

export type ConsumoInsumoAgg = { productId: string; nome: string; sku: string; quantidade: number; custo: number };

export async function consumoInsumos(range: Range, siteId: SiteFilter): Promise<ConsumoInsumoAgg[]> {
  const movs = await db.stockMovement.findMany({
    where: {
      tipo: { in: ["PRODUCAO", "ABERTURA"] },
      productionId: { not: null },
      createdAt: { gte: range.inicio, lt: range.fim },
      ...(siteId ? { siteId } : {}),
    },
    select: { productId: true, deltaFechado: true, deltaAberto: true, custoUnitario: true },
  });
  if (movs.length === 0) return [];
  const conteudo = await conteudoMap([...new Set(movs.map((m) => m.productId))]);

  const agg = new Map<string, { quantidade: number; custo: number }>();
  for (const m of movs) {
    const cu = m.custoUnitario != null ? n(m.custoUnitario) : 0;
    const cpu = conteudo.get(m.productId);
    const abertas = cpu && cpu > 0 ? Math.abs(n(m.deltaAberto)) / cpu : 0;
    const qtd = Math.abs(n(m.deltaFechado)) + abertas;
    if (qtd === 0) continue;
    const cur = agg.get(m.productId) ?? { quantidade: 0, custo: 0 };
    cur.quantidade += qtd;
    cur.custo += cu * qtd;
    agg.set(m.productId, cur);
  }

  const prods = await db.product.findMany({
    where: { id: { in: [...agg.keys()] } },
    select: { id: true, nome: true, sku: true },
  });
  const prodMap = new Map(prods.map((p) => [p.id, p]));

  return [...agg.entries()]
    .map(([productId, v]) => ({
      productId,
      nome: prodMap.get(productId)?.nome ?? productId,
      sku: prodMap.get(productId)?.sku ?? "",
      quantidade: Math.round(v.quantidade * 1000) / 1000,
      custo: Math.round(v.custo * 100) / 100,
    }))
    .sort((a, b) => b.custo - a.custo);
}

/** Rentabilidade dos personalizados/drinks: receita − custo de insumos (via produção). */
export async function rentabilidadeDrinks(range: Range, siteId: SiteFilter): Promise<ProdutoVendaAgg[]> {
  const ranking = await rankingProdutos(range, siteId);
  const personalizados = await db.product.findMany({
    where: { id: { in: ranking.map((r) => r.productId) }, tipo: "PERSONALIZADO" },
    select: { id: true },
  });
  const ids = new Set(personalizados.map((p) => p.id));
  return ranking.filter((r) => ids.has(r.productId));
}

// ── Pagamentos & caixa ──────────────────────────────────────

export type FechamentoCaixaRow = {
  sessaoId: string;
  siteNome: string;
  abertaEm: Date;
  fechadaEm: Date | null;
  valorAbertura: number;
  vendasDinheiro: number;
  esperado: number;
  contado: number | null;
  quebra: number | null;
};

export async function fechamentosCaixa(range: Range, siteId: SiteFilter): Promise<FechamentoCaixaRow[]> {
  const sessoes = await db.cashSession.findMany({
    where: {
      status: "FECHADA",
      fechadaEm: { gte: range.inicio, lt: range.fim },
      ...(siteId ? { siteId } : {}),
    },
    select: {
      id: true,
      valorAbertura: true,
      valorFechamento: true,
      abertaEm: true,
      fechadaEm: true,
      site: { select: { nome: true } },
      movements: { select: { tipo: true, valor: true } },
      sales: {
        where: { status: "PAGA" },
        select: { payments: { where: { status: "CONFIRMADO" }, select: { metodo: true, valor: true, troco: true } } },
      },
    },
    orderBy: { fechadaEm: "desc" },
  });

  return sessoes.map((s) => {
    let suprimentos = 0;
    let sangrias = 0;
    for (const m of s.movements) {
      if (m.tipo === "SUPRIMENTO") suprimentos += n(m.valor);
      if (m.tipo === "SANGRIA") sangrias += n(m.valor);
    }
    let vendasDinheiro = 0;
    for (const venda of s.sales) {
      for (const p of venda.payments) {
        if (p.metodo === "DINHEIRO") vendasDinheiro += n(p.valor) - n(p.troco);
      }
    }
    const valorAbertura = n(s.valorAbertura);
    const esperado = valorAbertura + suprimentos - sangrias + vendasDinheiro;
    const contado = s.valorFechamento != null ? n(s.valorFechamento) : null;
    return {
      sessaoId: s.id,
      siteNome: s.site?.nome ?? "—",
      abertaEm: s.abertaEm,
      fechadaEm: s.fechadaEm,
      valorAbertura,
      vendasDinheiro,
      esperado,
      contado,
      quebra: contado != null ? Math.round((contado - esperado) * 100) / 100 : null,
    };
  });
}
