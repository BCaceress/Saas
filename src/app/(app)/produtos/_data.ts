import { db } from "@/lib/prisma";
import { derive, type DeriveComponent } from "@/lib/derive";
import type { Prisma } from "@/generated/prisma";
import type {
  BrandOpt,
  CategoryOpt,
  SubcategoryOpt,
  StorageOpt,
  SupplierRow,
  FiscalOpt,
  ComponentCandidate,
  ProductRow,
} from "./_types";

const dec = (v: { toNumber: () => number } | null | undefined) =>
  v == null ? null : v.toNumber();

/** Include usado tanto na listagem de /produtos quanto na busca global do navbar. */
export const PRODUCT_INCLUDE = {
  brand: true,
  subcategory: { include: { category: true } },
  stocks: {
    include: {
      site: { select: { nome: true, ativo: true } },
      location: { select: { nome: true, tipo: true, ativo: true } },
    },
  },
  packagings: { orderBy: { nome: "asc" } },
  suppliers: {
    include: { supplier: { select: { razaoSocial: true, nomeFantasia: true } } },
    orderBy: { isPrincipal: "desc" },
  },
  components: { include: { component: { include: { stocks: true } } } },
} satisfies Prisma.ProductInclude;

type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

/** Mapeia um Product (com relações) para o shape usado na UI (§6: combos/receitas derivam custo/disponibilidade). */
export function toProductRow(p: ProductWithRelations, totalVendido: number): ProductRow {
  const principal = p.suppliers.find((s) => s.isPrincipal);

  const composto = p.tipo === "COMBO" || p.tipo === "PERSONALIZADO";
  let custoDerivado: number | null = null;
  let disponibilidadeDerivada: number | null = null;
  if (composto) {
    const comps: DeriveComponent[] = p.components.map((c) => ({
      quantidade: dec(c.quantidade) ?? 0,
      unidade: c.unidade,
      custo: dec(c.component.custo),
      precoVenda: dec(c.component.precoVenda),
      conteudoPorUnidade: dec(c.component.conteudoPorUnidade),
      estoqueFechado: c.component.stocks.reduce((s, st) => s + Number(st.estoqueFechado), 0),
      estoqueAberto: c.component.stocks.reduce((s, st) => s + Number(st.estoqueAberto), 0),
    }));
    const d = derive(comps);
    custoDerivado = d.custoTotal;
    disponibilidadeDerivada = d.disponibilidade;
  }

  return {
    id: p.id,
    tipo: p.tipo,
    nome: p.nome,
    sku: p.sku,
    ean: p.ean,
    imagemUrl: p.imagemUrl,
    marca: p.brand?.nome ?? null,
    brandId: p.brandId,
    subcategoriaNome: p.subcategory?.nome ?? "",
    subcategoryId: p.subcategoryId ?? "",
    categoriaNome: p.subcategory?.category.nome ?? "",
    precoVenda: dec(p.precoVenda),
    custo: composto ? custoDerivado : dec(p.custo),
    ativo: p.ativo,
    restricaoIdade: p.restricaoIdade,
    unidadeBase: p.unidadeBase,
    fracionavel: p.fracionavel,
    conteudoPorUnidade: dec(p.conteudoPorUnidade),
    vendeOnline: p.vendeOnline,
    fiscalProfileId: p.fiscalProfileId,
    estoque: {
      fechado: p.stocks.reduce((s, st) => s + Number(st.estoqueFechado), 0),
      aberto: p.stocks.reduce((s, st) => s + Number(st.estoqueAberto), 0),
      minimo: dec(p.stocks[0]?.estoqueMinimo) ?? 0,
      ideal: dec(p.stocks[0]?.estoqueIdeal) ?? 0,
      locationId: p.stocks[0]?.locationId ?? null,
    },
    fornecedorPrincipalId: principal?.supplierId ?? null,
    custoFornecedor: dec(principal?.custoFornecedor),
    disponibilidadeDerivada,
    salesChannels: [],
    packagings: p.packagings.map((pk) => ({
      id: pk.id,
      nome: pk.nome,
      ean: pk.ean,
      fatorConversao: dec(pk.fatorConversao) ?? 1,
    })),
    fornecedores: p.suppliers.map((ps) => ({
      id: ps.supplierId,
      nome: ps.supplier.nomeFantasia ?? ps.supplier.razaoSocial,
      isPrincipal: ps.isPrincipal,
    })),
    totalVendido,
    locais: p.stocks
      .filter((st) => st.siteId !== null)
      .map((st) => ({
        siteId: st.siteId!,
        siteNome: st.site?.nome ?? "",
        siteAtivo: st.site?.ativo ?? true,
        locationNome: st.location?.nome ?? null,
        locationTipo: st.location?.tipo ?? null,
        locationAtivo: st.location?.ativo ?? null,
        fechado: Number(st.estoqueFechado),
        aberto: Number(st.estoqueAberto),
      })),
  };
}

export type ProductFormOptions = {
  brandOpts: BrandOpt[];
  categoryOpts: CategoryOpt[];
  subOpts: SubcategoryOpt[];
  storageOpts: StorageOpt[];
  supplierRows: SupplierRow[];
  fiscalOpts: FiscalOpt[];
};

/**
 * Opções para os formulários de produto (marcas, subcategorias ativas, locais,
 * fornecedores, perfis fiscais). Roda dentro de `runWithTenant`.
 */
export async function loadProductFormOptions(): Promise<ProductFormOptions> {
  const [categories, brands, locations, suppliers, fiscalProfiles] = await Promise.all([
    db.category.findMany({
      orderBy: { nome: "asc" },
      include: { subcategories: { where: { ativo: true }, orderBy: { nome: "asc" } } },
    }),
    db.brand.findMany({ orderBy: { nome: "asc" } }),
    db.storageLocation.findMany({
      where: { ativo: true },
      orderBy: { nome: "asc" },
      include: { site: { select: { nome: true } } },
    }),
    db.supplier.findMany({ where: { ativo: true }, orderBy: { razaoSocial: "asc" } }),
    db.fiscalProfile.findMany({ orderBy: { nome: "asc" } }),
  ]);

  const subOpts: SubcategoryOpt[] = categories.flatMap((c) =>
    c.subcategories.map((s) => ({
      id: s.id,
      nome: s.nome,
      categoriaNome: c.nome,
      skuPrefix: s.skuPrefix,
      categorySkuPrefix: c.skuPrefix,
      defaultStorageType: s.defaultStorageType,
      defaultFiscalProfileId: s.defaultFiscalProfileId,
    }))
  );

  return {
    brandOpts: brands.map((b) => ({ id: b.id, nome: b.nome })),
    categoryOpts: categories.map((c) => ({ id: c.id, nome: c.nome })),
    subOpts,
    storageOpts: locations.map((l) => ({
      id: l.id,
      nome: l.nome,
      tipo: l.tipo,
      ativo: l.ativo,
      siteId: l.siteId,
      siteNome: l.site?.nome ?? null,
    })),
    supplierRows: suppliers.map((s) => ({
      id: s.id,
      cnpj: s.cnpj,
      razaoSocial: s.razaoSocial,
      nomeFantasia: s.nomeFantasia,
      email: s.email,
      telefone: s.telefone,
      nomeContatoPrincipal: s.nomeContatoPrincipal,
      website: s.website,
      cep: s.cep,
      logradouro: s.logradouro,
      numero: s.numero,
      complemento: s.complemento,
      bairro: s.bairro,
      municipio: s.municipio,
      uf: s.uf,
      ativo: s.ativo,
    })),
    fiscalOpts: fiscalProfiles.map((f) => ({
      id: f.id,
      nome: f.nome,
      ncm: f.ncm,
      precisaRevisao: f.precisaRevisao,
    })),
  };
}

/**
 * Produtos elegíveis como item de combo/receita: SIMPLES e INSUMO ativos do
 * tenant, com custo/preço/estoque para a derivação ao vivo (PRD §3/§6).
 * Roda dentro de `runWithTenant`.
 */
export async function loadComponentCandidates(): Promise<ComponentCandidate[]> {
  const products = await db.product.findMany({
    where: { tipo: { in: ["SIMPLES", "INSUMO"] }, ativo: true },
    orderBy: { nome: "asc" },
    include: { brand: true, stocks: true },
  });

  return products.map((p) => ({
    id: p.id,
    nome: p.nome,
    sku: p.sku,
    tipo: p.tipo,
    imagemUrl: p.imagemUrl,
    marca: p.brand?.nome ?? null,
    precoVenda: dec(p.precoVenda),
    custo: dec(p.custo),
    unidadeBase: p.unidadeBase,
    fracionavel: p.fracionavel,
    conteudoPorUnidade: dec(p.conteudoPorUnidade),
    restricaoIdade: p.restricaoIdade,
    estoqueFechado: p.stocks.reduce((s, st) => s + Number(st.estoqueFechado), 0),
    estoqueAberto: p.stocks.reduce((s, st) => s + Number(st.estoqueAberto), 0),
  }));
}

export type ProductInsights = {
  vendasHoje: number;
  vendas7d: number;
  vendas30d: number;
  diasSemVenda: number | null;
  diasSemCompra: number | null;
  /** Margem estimada há ~30 dias, a partir do custoMedio do StockSnapshot (§7). null = sem histórico. */
  margemAnteriorPct: number | null;
};

const DIA_MS = 24 * 60 * 60 * 1000;
const diasDesde = (d: Date | null | undefined) =>
  d ? Math.floor((Date.now() - d.getTime()) / DIA_MS) : null;

/**
 * Sinais de alerta de um produto (venda hoje, dias sem venda/compra, tendência
 * de margem) — buscados sob demanda ao abrir o sidepanel, não na listagem
 * (evita N+1 nas ~4 queries extras para cada linha da tabela).
 */
export async function loadProductInsights(
  productId: string,
  tipo: "SIMPLES" | "INSUMO" | "COMBO" | "PERSONALIZADO",
  precoVendaAtual: number | null
): Promise<ProductInsights> {
  const hojeInicio = new Date();
  hojeInicio.setHours(0, 0, 0, 0);
  const amanha = new Date(hojeInicio.getTime() + DIA_MS);
  const seteDiasAtras = new Date(hojeInicio.getTime() - 6 * DIA_MS);
  const trintaDiasAtras = new Date(hojeInicio.getTime() - 29 * DIA_MS);
  const snapshotRef = new Date(hojeInicio.getTime() - 30 * DIA_MS);

  const vendeDireto = tipo !== "INSUMO";
  const compraDireto = tipo === "SIMPLES" || tipo === "INSUMO";

  const [vendaHojeAgg, venda7dAgg, venda30dAgg, ultimaVenda, ultimaCompra, snapshot] = await Promise.all([
    vendeDireto
      ? db.saleItem.aggregate({
          where: { productId, sale: { status: "PAGA", paidAt: { gte: hojeInicio, lt: amanha } } },
          _sum: { quantidade: true },
        })
      : null,
    vendeDireto
      ? db.saleItem.aggregate({
          where: { productId, sale: { status: "PAGA", paidAt: { gte: seteDiasAtras, lt: amanha } } },
          _sum: { quantidade: true },
        })
      : null,
    vendeDireto
      ? db.saleItem.aggregate({
          where: { productId, sale: { status: "PAGA", paidAt: { gte: trintaDiasAtras, lt: amanha } } },
          _sum: { quantidade: true },
        })
      : null,
    vendeDireto
      ? db.saleItem.findFirst({
          where: { productId, sale: { status: "PAGA" } },
          orderBy: { sale: { paidAt: "desc" } },
          select: { sale: { select: { paidAt: true } } },
        })
      : null,
    compraDireto
      ? db.purchaseItem.findFirst({
          where: { productId },
          orderBy: { purchase: { data: "desc" } },
          select: { purchase: { select: { data: true } } },
        })
      : null,
    db.stockSnapshot.findFirst({
      where: { productId, data: { lte: snapshotRef }, custoMedio: { not: null } },
      orderBy: { data: "desc" },
      select: { custoMedio: true },
    }),
  ]);

  let margemAnteriorPct: number | null = null;
  if (snapshot?.custoMedio != null && precoVendaAtual != null && precoVendaAtual > 0) {
    margemAnteriorPct = ((precoVendaAtual - snapshot.custoMedio.toNumber()) / precoVendaAtual) * 100;
  }

  return {
    vendasHoje: Number(vendaHojeAgg?._sum.quantidade ?? 0),
    vendas7d: Number(venda7dAgg?._sum.quantidade ?? 0),
    vendas30d: Number(venda30dAgg?._sum.quantidade ?? 0),
    diasSemVenda: diasDesde(ultimaVenda?.sale.paidAt),
    diasSemCompra: diasDesde(ultimaCompra?.purchase.data),
    margemAnteriorPct,
  };
}
