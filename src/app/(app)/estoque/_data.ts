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
  locationNome: string | null;
};

export type MovimentacaoRow = {
  id: string;
  tipo: string;
  productNome: string;
  productSku: string;
  deltaFechado: number;
  deltaAberto: number;
  custoUnitario: number | null;
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
  data: Date;
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
      product: { select: { id: true, sku: true, ean: true, nome: true, tipo: true, unidadeBase: true, fracionavel: true, conteudoPorUnidade: true, custoMedio: true } },
      location: { select: { nome: true } },
    },
    orderBy: { product: { nome: "asc" } },
  });

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
      locationNome: s.location?.nome ?? null,
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

  // Fetch products for names
  const productIds = [...new Set(movements.map((m) => m.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, nome: true, sku: true },
  });
  const prodMap = new Map(products.map((p) => [p.id, p]));

  return movements.map((m) => ({
    id: m.id,
    tipo: m.tipo,
    productNome: prodMap.get(m.productId)?.nome ?? m.productId,
    productSku: prodMap.get(m.productId)?.sku ?? "",
    deltaFechado: n(m.deltaFechado),
    deltaAberto: n(m.deltaAberto),
    custoUnitario: m.custoUnitario ? n(m.custoUnitario) : null,
    observacao: m.observacao,
    createdAt: m.createdAt,
  }));
}

// ── Entradas ─────────────────────────────────────────────────

export async function loadEntradas(siteId: string | null): Promise<EntradaRow[]> {
  const purchases = await db.purchase.findMany({
    where: siteId ? { siteId } : {},
    include: {
      supplier: { select: { razaoSocial: true, nomeFantasia: true } },
      items: { select: { id: true, productId: true, packagingId: true, quantidade: true, custoTotal: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const allProductIds = [...new Set(purchases.flatMap((p) => p.items.map((i) => i.productId)))];
  const allPackagingIds = [...new Set(purchases.flatMap((p) => p.items.flatMap((i) => i.packagingId ? [i.packagingId] : [])))];

  const [products, packagings] = await Promise.all([
    allProductIds.length > 0
      ? db.product.findMany({ where: { id: { in: allProductIds } }, select: { id: true, nome: true, sku: true, tipo: true } })
      : Promise.resolve([]),
    allPackagingIds.length > 0
      ? db.productPackaging.findMany({ where: { id: { in: allPackagingIds } }, select: { id: true, nome: true, fatorConversao: true } })
      : Promise.resolve([]),
  ]);

  const prodMap = new Map(products.map((p) => [p.id, p]));
  const pkgMap = new Map(packagings.map((pk) => [pk.id, pk]));

  return purchases.map((p) => ({
    id: p.id,
    tipo: p.tipo,
    supplierNome: p.supplier ? (p.supplier.nomeFantasia ?? p.supplier.razaoSocial) : null,
    numeroNota: p.numeroNota,
    data: p.data,
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

// ── Form options for entrada ──────────────────────────────────

export async function loadEntradaFormOptions() {
  const [products, suppliers, sites] = await Promise.all([
    db.product.findMany({
      where: { ativo: true, tipo: { in: ["SIMPLES", "INSUMO"] } },
      include: {
        packagings: { select: { id: true, nome: true, fatorConversao: true, isCompraDefault: true } },
        suppliers: { select: { supplierId: true } },
        brand: { select: { nome: true } },
      },
      orderBy: { nome: "asc" },
    }),
    db.supplier.findMany({ where: { ativo: true }, orderBy: { razaoSocial: "asc" } }),
    db.site.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } }),
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
