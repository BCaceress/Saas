import { db } from "@/lib/prisma";
import type {
  BrandOpt,
  CategoryOpt,
  SubcategoryOpt,
  StorageOpt,
  SupplierRow,
  FiscalOpt,
  ComponentCandidate,
} from "./_types";

const dec = (v: { toNumber: () => number } | null | undefined) =>
  v == null ? null : v.toNumber();

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
