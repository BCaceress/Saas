"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/prisma";
import { guardAction } from "@/lib/guard";
import { assertCabeProduto } from "@/lib/limites";
import { runWithTenant } from "@/lib/tenant-context";
import { normalizeBrand, normalizeSkuPrefix, onlyDigits } from "@/lib/normalize";
import { getOrCreateDefaultSite } from "@/lib/sites";
import { generateSku } from "@/lib/sku";
import { getCosmosByEan, CosmosError } from "@/lib/cosmos";
import { completeJson, llmConfigured } from "@/lib/llm";
import {
  PRODUCT_INCLUDE,
  toProductRow,
  loadProductInsights,
  loadGerenciarExtras,
  type ProductInsights,
  type GerenciarExtras,
} from "./_data";
import type { ProductRow } from "./_types";
import type { StorageType } from "@/generated/prisma";

/**
 * Roda `fn` no contexto de tenant do usuário logado e entrega o tenantId.
 * Reads/updates/deletes via `db` herdam o tenantId pelo extension; em CREATEs
 * (inclusive aninhados) passamos `tid` à mão, porque o extension não cobre
 * writes aninhados nem os tipos do Prisma (ver CLAUDE.md).
 */
async function tx<T>(fn: (tid: string) => Promise<T>): Promise<T> {
  const ctx = await guardAction("produto.editar");
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id));
}

const ok = () => {
  revalidatePath("/produtos");
  revalidatePath("/estoque");
};

const okStorage = () => {
  revalidatePath("/produtos");
  revalidatePath("/configuracoes/sites");
  revalidatePath("/estoque");
};

// ── Busca global (navbar) ──────────────────────────────────
/** Busca parcial por nome, SKU ou código de barras — usada pela busca global do navbar. */
export async function searchProducts(queryRaw: string): Promise<ProductRow[]> {
  const term = queryRaw.trim();
  if (term.length < 3) return [];

  return tx(async () => {
    const products = await db.product.findMany({
      where: {
        ativo: true,
        OR: [
          { nome: { contains: term, mode: "insensitive" } },
          { sku: { contains: term, mode: "insensitive" } },
          { ean: { contains: term, mode: "insensitive" } },
        ],
      },
      orderBy: { nome: "asc" },
      take: 8,
      include: PRODUCT_INCLUDE,
    });

    return products.map((p) => toProductRow(p));
  });
}

/** Dados dos sheets de gerenciamento — buscado sob demanda ao abrir "Gerenciar" em /produtos. */
export async function getGerenciarExtras(): Promise<GerenciarExtras> {
  return tx(() => loadGerenciarExtras());
}

/** Alertas do sidepanel — buscado sob demanda ao abrir o produto. */
export async function getProductInsights(
  productId: string,
  tipo: "SIMPLES" | "INSUMO" | "COMBO" | "PERSONALIZADO",
  precoVendaAtual: number | null
): Promise<ProductInsights> {
  return tx(() => loadProductInsights(productId, tipo, precoVendaAtual));
}

// ── Marcas ─────────────────────────────────────────────────
export async function createBrand(nomeRaw: string) {
  return tx(async (tid) => {
    const nome = nomeRaw.trim();
    if (nome.length < 2) throw new Error("Informe o nome da marca.");
    const nomeNormalizado = normalizeBrand(nome);
    const existing = await db.brand.findFirst({ where: { nomeNormalizado } });
    if (existing) {
      ok();
      return { id: existing.id, nome: existing.nome, jaExistia: true };
    }
    const brand = await db.brand.create({ data: { tenantId: tid, nome, nomeNormalizado } });
    ok();
    return { id: brand.id, nome: brand.nome, jaExistia: false };
  });
}

// ── Categorias / subcategorias ─────────────────────────────
/** Base de 3 chars (A–Z/0–9) para o prefixo de SKU, derivada do nome. */
function prefixBase(nome: string): string {
  const norm = normalizeSkuPrefix(nome);
  return (norm.length >= 3 ? norm.slice(0, 3) : (norm + "XXX").slice(0, 3));
}

/** Prefixo único de categoria no tenant, derivado do nome (BEB, BEB2…). */
async function uniqueCategoryPrefix(nome: string): Promise<string> {
  const base = prefixBase(nome);
  for (let i = 0; i < 50; i++) {
    const cand = i === 0 ? base : (base.slice(0, 3) + i).slice(0, 4);
    const hit = await db.category.findFirst({ where: { skuPrefix: cand }, select: { id: true } });
    if (!hit) return cand;
  }
  return (base.slice(0, 2) + Math.floor(10 + Math.random() * 89));
}

/** Prefixo único de subcategoria dentro da categoria, derivado do nome. */
async function uniqueSubcategoryPrefix(categoryId: string, nome: string): Promise<string> {
  const base = prefixBase(nome);
  for (let i = 0; i < 50; i++) {
    const cand = i === 0 ? base : (base.slice(0, 3) + i).slice(0, 4);
    const hit = await db.subcategory.findFirst({
      where: { categoryId, skuPrefix: cand },
      select: { id: true },
    });
    if (!hit) return cand;
  }
  return (base.slice(0, 2) + Math.floor(10 + Math.random() * 89));
}

export async function createCategory(nomeRaw: string) {
  return tx(async (tid) => {
    const nome = nomeRaw.trim();
    if (nome.length < 2) throw new Error("Informe o nome da categoria.");
    const existing = await db.category.findFirst({
      where: { nome: { equals: nome, mode: "insensitive" } },
    });
    if (existing) {
      ok();
      return { id: existing.id, nome: existing.nome, jaExistia: true };
    }
    const skuPrefix = await uniqueCategoryPrefix(nome);
    const cat = await db.category.create({ data: { tenantId: tid, nome, skuPrefix } });
    ok();
    return { id: cat.id, nome: cat.nome, jaExistia: false };
  });
}

export async function createSubcategory(input: {
  categoryId: string;
  nome: string;
  defaultStorageType?: StorageType | null;
  defaultFiscalProfileId?: string | null;
}) {
  return tx(async (tid) => {
    const nome = input.nome.trim();
    if (nome.length < 2) throw new Error("Informe o nome da subcategoria.");
    if (!input.categoryId) throw new Error("Escolha a categoria.");
    const dup = await db.subcategory.findFirst({
      where: { categoryId: input.categoryId, nome: { equals: nome, mode: "insensitive" } },
    });
    if (dup) throw new Error(`Já existe a subcategoria «${dup.nome}» nesta categoria.`);
    const skuPrefix = await uniqueSubcategoryPrefix(input.categoryId, nome);
    const sub = await db.subcategory.create({
      data: {
        tenantId: tid,
        categoryId: input.categoryId,
        nome,
        skuPrefix,
        defaultStorageType: input.defaultStorageType ?? null,
        defaultFiscalProfileId: input.defaultFiscalProfileId ?? null,
      },
    });
    ok();
    return sub.id;
  });
}

export async function updateSubcategory(input: { id: string; nome: string }) {
  return tx(async () => {
    const nome = input.nome.trim();
    if (nome.length < 2) throw new Error("Informe o nome da subcategoria.");
    const atual = await db.subcategory.findFirst({ where: { id: input.id } });
    if (!atual) throw new Error("Subcategoria não encontrada.");
    const dup = await db.subcategory.findFirst({
      where: {
        categoryId: atual.categoryId,
        nome: { equals: nome, mode: "insensitive" },
        id: { not: input.id },
      },
    });
    if (dup) throw new Error(`Já existe a subcategoria «${dup.nome}» nesta categoria.`);
    await db.subcategory.update({ where: { id: input.id }, data: { nome } });
    ok();
  });
}

export async function setSubcategoryActive(id: string, ativo: boolean) {
  return tx(async () => {
    await db.subcategory.update({ where: { id }, data: { ativo } });
    ok();
  });
}

// ── Armazenagem ────────────────────────────────────────────
export async function createStorageLocation(input: {
  nome: string;
  tipo: StorageType;
  siteId: string;
}) {
  return tx(async (tid) => {
    const nome = input.nome.trim();
    if (nome.length < 2) throw new Error("Informe o nome do local.");
    if (!input.siteId) throw new Error("Selecione o estabelecimento.");
    const dup = await db.storageLocation.findFirst({
      where: { siteId: input.siteId, nome: { equals: nome, mode: "insensitive" } },
    });
    if (dup) throw new Error(`Já existe um local com o nome "${nome}" neste estabelecimento.`);
    const loc = await db.storageLocation.create({
      data: { tenantId: tid, nome, tipo: input.tipo, siteId: input.siteId },
    });
    okStorage();
    return loc.id;
  });
}

export async function updateStorageLocation(
  id: string,
  input: { nome: string; tipo: StorageType; siteId: string },
) {
  return tx(async () => {
    const nome = input.nome.trim();
    if (nome.length < 2) throw new Error("Informe o nome do local.");
    if (!input.siteId) throw new Error("Selecione o estabelecimento.");
    const dup = await db.storageLocation.findFirst({
      where: { siteId: input.siteId, nome: { equals: nome, mode: "insensitive" }, id: { not: id } },
    });
    if (dup) throw new Error(`Já existe um local com o nome "${nome}" neste estabelecimento.`);
    await db.storageLocation.update({
      where: { id },
      data: { nome, tipo: input.tipo, siteId: input.siteId },
    });
    okStorage();
  });
}

export async function deleteStorageLocation(id: string) {
  return tx(async () => {
    const hasStock = await db.stock.findFirst({ where: { locationId: id } });
    if (hasStock)
      throw new Error(
        "Não é possível excluir: há produtos vinculados a este local. Inative-o.",
      );
    await db.storageLocation.delete({ where: { id } });
    okStorage();
  });
}

export async function toggleStorageLocationAtivo(id: string, ativo: boolean) {
  return tx(async () => {
    await db.storageLocation.update({ where: { id }, data: { ativo } });
    okStorage();
  });
}

// ── Fornecedores ───────────────────────────────────────────
const supplierSchema = z.object({
  cnpj: z.string().optional(),
  razaoSocial: z.string().min(2, "Informe a razão social."),
  nomeFantasia: z.string().optional(),
  email: z.string().email("E-mail inválido.").optional().or(z.literal("")),
  telefone: z.string().optional(),
  nomeContatoPrincipal: z.string().optional(),
  website: z.string().optional(),
  logoUrl: z.string().trim().optional().nullable(),
  pedidoMinimo: z.number().nonnegative().optional().nullable(),
  cep: z.string().optional(),
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  municipio: z.string().optional(),
  codigoMunicipio: z.string().optional(),
  uf: z.string().optional(),
  // Fiscal — usados na entrada por XML e na devolução ao fornecedor.
  ie: z.string().optional(),
  indicadorIE: z.enum(["CONTRIBUINTE", "ISENTO", "NAO_CONTRIBUINTE"]).optional().nullable(),
});

function supplierData(d: z.infer<typeof supplierSchema>) {
  const logoUrl = d.logoUrl?.trim() ?? "";
  if (logoUrl && !/^(data:image\/(png|jpeg|webp|svg\+xml);base64,|https?:\/\/)/.test(logoUrl)) {
    throw new Error("Logo invalida - envie a imagem novamente.");
  }
  if (logoUrl.length > 700_000) {
    throw new Error("Logo muito grande - envie uma imagem menor.");
  }
  return {
    cnpj: d.cnpj ? onlyDigits(d.cnpj) : null,
    razaoSocial: d.razaoSocial.trim(),
    nomeFantasia: d.nomeFantasia?.trim() || null,
    email: d.email || null,
    telefone: d.telefone?.trim() || null,
    nomeContatoPrincipal: d.nomeContatoPrincipal?.trim() || null,
    website: d.website?.trim() || null,
    pedidoMinimo: d.pedidoMinimo ?? null,
    ...("logoUrl" in d ? { logoUrl: logoUrl || null } : {}),
    cep: d.cep ? onlyDigits(d.cep) : null,
    logradouro: d.logradouro?.trim() || null,
    numero: d.numero?.trim() || null,
    complemento: d.complemento?.trim() || null,
    bairro: d.bairro?.trim() || null,
    municipio: d.municipio?.trim() || null,
    codigoMunicipio: d.codigoMunicipio ? onlyDigits(d.codigoMunicipio) || null : null,
    uf: d.uf?.trim().toUpperCase().slice(0, 2) || null,
    ie: d.ie?.trim() || null,
    indicadorIE: d.indicadorIE ?? null,
  };
}

export async function createSupplier(input: z.input<typeof supplierSchema>) {
  return tx(async (tid) => {
    const d = supplierSchema.parse(input);
    const data = supplierData(d);
    if (data.cnpj) {
      const dup = await db.supplier.findFirst({ where: { cnpj: data.cnpj } });
      if (dup) throw new Error(`Já existe um fornecedor com esse CNPJ: «${dup.nomeFantasia || dup.razaoSocial}».`);
    }
    const sup = await db.supplier.create({ data: { tenantId: tid, ...data } });
    ok();
    return sup.id;
  });
}

export async function updateSupplier(id: string, input: z.input<typeof supplierSchema>) {
  return tx(async () => {
    const d = supplierSchema.parse(input);
    const data = supplierData(d);
    if (data.cnpj) {
      const dup = await db.supplier.findFirst({ where: { cnpj: data.cnpj, id: { not: id } } });
      if (dup) throw new Error(`Já existe um fornecedor com esse CNPJ: «${dup.nomeFantasia || dup.razaoSocial}».`);
    }
    await db.supplier.update({ where: { id }, data });
    ok();
  });
}

export async function setSupplierActive(id: string, ativo: boolean) {
  return tx(async () => {
    await db.supplier.update({ where: { id }, data: { ativo } });
    ok();
  });
}

// ── Canais de venda online (§7) — compartilhado entre os tipos ─
const salesChannelSchema = z.object({
  canal: z.enum(["IFOOD", "MERCADO_LIVRE", "PROPRIO"]),
  precoCanal: z.number().nonnegative(),
  descricaoCanal: z.string().optional().nullable(),
});

/** Substitui o conjunto de canais ativos do produto (delete + recreate). */
async function syncSalesChannels(
  tid: string,
  productId: string,
  channels: z.infer<typeof salesChannelSchema>[],
) {
  await db.productSalesChannel.deleteMany({ where: { productId } });
  if (channels.length) {
    await db.productSalesChannel.createMany({
      data: channels.map((c) => ({
        tenantId: tid,
        productId,
        canal: c.canal,
        precoCanal: c.precoCanal,
        descricaoCanal: c.descricaoCanal ?? null,
        ativo: true,
      })),
    });
  }
}

/** Substitui o fornecedor principal do produto (remove qualquer isPrincipal anterior). */
async function syncPrincipalSupplier(
  tid: string,
  productId: string,
  fornecedorPrincipalId: string | null | undefined,
  custoFornecedor: number | null | undefined,
) {
  await db.productSupplier.deleteMany({ where: { productId, isPrincipal: true } });
  if (fornecedorPrincipalId) {
    await db.productSupplier.create({
      data: {
        tenantId: tid,
        productId,
        supplierId: fornecedorPrincipalId,
        custoFornecedor: custoFornecedor ?? null,
        isPrincipal: true,
      },
    });
  }
}

/** Substitui o conjunto de embalagens de compra do produto (delete + recreate). */
async function syncPackagings(
  tid: string,
  productId: string,
  packagings: { nome: string; ean?: string | null; fatorConversao: number }[],
) {
  await db.productPackaging.deleteMany({ where: { productId } });
  if (packagings.length) {
    await db.productPackaging.createMany({
      data: packagings.map((pk, i) => ({
        tenantId: tid,
        productId,
        nome: pk.nome.trim(),
        ean: pk.ean ? onlyDigits(pk.ean) : null,
        fatorConversao: pk.fatorConversao,
        isCompraDefault: i === 0,
      })),
    });
  }
}

// ── Produtos ───────────────────────────────────────────────
const productSchema = z.object({
  tipo: z.enum(["SIMPLES", "INSUMO"]).default("SIMPLES"),
  sku: z.string().optional(),
  ean: z.string().optional(),
  nome: z.string().min(2, "Informe o nome do produto."),
  subcategoryId: z.string().min(1, "Escolha a subcategoria."),
  brandId: z.string().optional().nullable(),
  marcaNome: z.string().optional(),
  imagemUrl: z.string().optional(),

  unidadeBase: z.enum(["UN", "ML", "G"]).default("UN"),
  fracionavel: z.boolean().default(false),
  conteudoPorUnidade: z.number().positive().optional().nullable(),

  precoVenda: z.number().nonnegative().optional().nullable(),
  custo: z.number().nonnegative().optional().nullable(),

  fiscalProfileId: z.string().optional().nullable(),
  restricaoIdade: z.boolean().default(false),

  // Fiscal POR ITEM. O tributário (NCM, CST, CFOP) vem do perfil fiscal — aqui
  // só o que muda de SKU para SKU. Vazio na esmagadora maioria dos produtos.
  gtinTributavel: z.string().optional().nullable(),
  unidadeTributavel: z.string().optional().nullable(),
  fatorConversaoTrib: z.number().positive().optional().nullable(),
  codigoAnp: z.string().optional().nullable(),

  controlaEstoque: z.boolean().default(true),
  estoqueMinimo: z.number().nonnegative().default(0),
  estoqueIdeal: z.number().nonnegative().default(0),
  estoqueInicial: z.number().nonnegative().default(0),
  locationId: z.string().optional().nullable(),

  fornecedorPrincipalId: z.string().optional().nullable(),
  custoFornecedor: z.number().nonnegative().optional().nullable(),

  // Embalagens de compra (fardo, caixa…) — cada uma com seu próprio código de
  // barras e fator de conversão p/ a unidade base de venda.
  packagings: z
    .array(
      z.object({
        nome: z.string().min(1, "Informe o nome da embalagem."),
        ean: z.string().optional().nullable(),
        fatorConversao: z.number().positive("Informe quantas unidades a embalagem contém."),
      }),
    )
    .optional()
    .default([]),

  vendeOnline: z.boolean().default(false),
  pesoGramas: z.number().int().positive().optional().nullable(),
  alturaCm: z.number().positive().optional().nullable(),
  larguraCm: z.number().positive().optional().nullable(),
  comprimentoCm: z.number().positive().optional().nullable(),
  descricaoOnline: z.string().optional(),

  tags: z.array(z.string()).optional(),
  salesChannels: z.array(salesChannelSchema).optional().default([]),
});

export type ProductInput = z.input<typeof productSchema>;

async function resolveBrandId(tid: string, brandId?: string | null, marcaNome?: string) {
  if (brandId) return brandId;
  const nome = marcaNome?.trim();
  if (!nome) return null;
  const nomeNormalizado = normalizeBrand(nome);
  const existing = await db.brand.findFirst({ where: { nomeNormalizado } });
  if (existing) return existing.id;
  const created = await db.brand.create({ data: { tenantId: tid, nome, nomeNormalizado } });
  return created.id;
}

export async function createProduct(input: ProductInput) {
  return tx(async (tid) => {
    const d = productSchema.parse(input);

    const sub = await db.subcategory.findFirst({
      where: { id: d.subcategoryId },
      include: { category: true },
    });
    if (!sub) throw new Error("Subcategoria inválida.");

    let sku: string;
    if (d.sku?.trim()) {
      const skuVal = d.sku.trim().toUpperCase();
      const existing = await db.product.findFirst({ where: { sku: skuVal }, select: { id: true } });
      if (existing) throw new Error(`SKU "${skuVal}" já está em uso.`);
      sku = skuVal;
    } else {
      sku = await generateSku(sub.category.skuPrefix, sub.skuPrefix);
    }
    const brandId = await resolveBrandId(tid, d.brandId, d.marcaNome);

    await assertCabeProduto(tid);
    const product = await db.product.create({
      data: {
        tenantId: tid,
        tipo: d.tipo,
        ean: d.ean ? onlyDigits(d.ean) : null,
        nome: d.nome.trim(),
        sku,
        subcategoryId: d.subcategoryId,
        brandId,
        imagemUrl: d.imagemUrl || null,
        unidadeBase: d.unidadeBase,
        fracionavel: d.fracionavel,
        conteudoPorUnidade: d.conteudoPorUnidade ?? null,
        precoVenda: d.tipo === "INSUMO" ? null : d.precoVenda ?? null,
        custo: d.custo ?? null,
        fiscalProfileId: d.fiscalProfileId ?? sub.defaultFiscalProfileId ?? null,
        restricaoIdade: d.restricaoIdade,
        gtinTributavel: d.gtinTributavel || null,
        unidadeTributavel: d.unidadeTributavel || null,
        fatorConversaoTrib: d.fatorConversaoTrib ?? null,
        codigoAnp: d.codigoAnp || null,
        controlaEstoque: d.tipo === "INSUMO" ? d.controlaEstoque : true,
        vendeOnline: d.vendeOnline,
        pesoGramas: d.pesoGramas ?? null,
        alturaCm: d.alturaCm ?? null,
        larguraCm: d.larguraCm ?? null,
        comprimentoCm: d.comprimentoCm ?? null,
        descricaoOnline: d.descricaoOnline || null,
        stocks: {
          create: [{
            tenantId: tid,
            siteId: (await getOrCreateDefaultSite(tid)).id,
            estoqueFechado: d.estoqueInicial,
            estoqueMinimo: d.estoqueMinimo,
            estoqueIdeal: d.estoqueIdeal,
            locationId: d.locationId ?? null,
          }],
        },
        ...(d.fornecedorPrincipalId
          ? {
              suppliers: {
                create: {
                  tenantId: tid,
                  supplierId: d.fornecedorPrincipalId,
                  custoFornecedor: d.custoFornecedor ?? null,
                  isPrincipal: true,
                },
              },
            }
          : {}),
      },
    });

    if (d.tags?.length) await attachTags(tid, product.id, d.tags);
    await syncSalesChannels(tid, product.id, d.salesChannels);
    await syncPackagings(tid, product.id, d.packagings);

    ok();
    return { id: product.id, sku };
  });
}

export async function updateProduct(id: string, input: ProductInput) {
  return tx(async (tid) => {
    const d = productSchema.parse(input);
    const brandId = await resolveBrandId(tid, d.brandId, d.marcaNome);
    let skuData: { sku?: string } = {};
    if (d.sku?.trim()) {
      const skuVal = d.sku.trim().toUpperCase();
      const existing = await db.product.findFirst({ where: { sku: skuVal, id: { not: id } }, select: { id: true } });
      if (existing) throw new Error(`SKU "${skuVal}" já está em uso.`);
      skuData = { sku: skuVal };
    }
    await db.product.update({
      where: { id },
      data: {
        ...skuData,
        ean: d.ean ? onlyDigits(d.ean) : null,
        nome: d.nome.trim(),
        subcategoryId: d.subcategoryId,
        brandId,
        imagemUrl: d.imagemUrl || null,
        unidadeBase: d.unidadeBase,
        fracionavel: d.fracionavel,
        conteudoPorUnidade: d.conteudoPorUnidade ?? null,
        precoVenda: d.tipo === "INSUMO" ? null : d.precoVenda ?? null,
        custo: d.custo ?? null,
        fiscalProfileId: d.fiscalProfileId ?? null,
        restricaoIdade: d.restricaoIdade,
        gtinTributavel: d.gtinTributavel || null,
        unidadeTributavel: d.unidadeTributavel || null,
        fatorConversaoTrib: d.fatorConversaoTrib ?? null,
        codigoAnp: d.codigoAnp || null,
        controlaEstoque: d.tipo === "INSUMO" ? d.controlaEstoque : true,
        vendeOnline: d.vendeOnline,
        pesoGramas: d.pesoGramas ?? null,
        alturaCm: d.alturaCm ?? null,
        larguraCm: d.larguraCm ?? null,
        comprimentoCm: d.comprimentoCm ?? null,
        descricaoOnline: d.descricaoOnline || null,
      },
    });
    // Propaga mínimo/ideal para todos os stocks existentes deste produto
    await db.stock.updateMany({
      where: { productId: id },
      data: { estoqueMinimo: d.estoqueMinimo, estoqueIdeal: d.estoqueIdeal },
    });
    await syncSalesChannels(tid, id, d.salesChannels);
    await syncPackagings(tid, id, d.packagings);
    await syncPrincipalSupplier(tid, id, d.fornecedorPrincipalId, d.custoFornecedor);
    ok();
  });
}

export async function archiveProduct(id: string, ativo: boolean) {
  return tx(async () => {
    await db.product.update({ where: { id }, data: { ativo } });
    ok();
  });
}

async function attachTags(tid: string, productId: string, tags: string[]) {
  for (const raw of tags) {
    const nome = raw.trim();
    if (!nome) continue;
    let tag = await db.tag.findFirst({ where: { nome } });
    if (!tag) tag = await db.tag.create({ data: { tenantId: tid, nome } });
    await db.productTag
      .create({ data: { tenantId: tid, productId, tagId: tag.id } })
      .catch(() => {});
  }
}

// ── Combos / Kits ──────────────────────────────────────────
const comboComponentSchema = z.object({
  componentProductId: z.string().min(1),
  quantidade: z.number().positive(),
});

const comboSchema = z.object({
  nome: z.string().min(2, "Informe o nome do combo."),
  subcategoryId: z.string().optional(),
  brandId: z.string().optional().nullable(),
  marcaNome: z.string().optional(),
  imagemUrl: z.string().optional(),
  precoVenda: z.number().nonnegative().optional().nullable(),
  fiscalProfileId: z.string().optional().nullable(),
  restricaoIdade: z.boolean().default(false),
  vendeOnline: z.boolean().default(false),
  pesoGramas: z.number().int().positive().optional().nullable(),
  alturaCm: z.number().positive().optional().nullable(),
  larguraCm: z.number().positive().optional().nullable(),
  comprimentoCm: z.number().positive().optional().nullable(),
  descricaoOnline: z.string().optional(),
  tags: z.array(z.string()).optional(),
  components: z
    .array(comboComponentSchema)
    .min(1, "Adicione ao menos um item ao combo."),
  salesChannels: z.array(salesChannelSchema).optional().default([]),
});

export type ComboInput = z.input<typeof comboSchema>;

/**
 * Combo/receita herdam +18 se QUALQUER componente for restrito (ou marcado à mão).
 * Os componentes precisam existir e ser SIMPLES/INSUMO do próprio tenant.
 */
async function validateComponentProducts(
  components: { componentProductId: string }[],
  marcadoIdade: boolean,
  groupItems: { componentProductId: string }[][] = [],
) {
  const allItems = [...components, ...groupItems.flat()];
  const ids = allItems.map((c) => c.componentProductId);
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0)
    throw new Error("Adicione ao menos um componente ou grupo à ficha.");
  const found = await db.product.findMany({
    where: { id: { in: uniqueIds }, tipo: { in: ["SIMPLES", "INSUMO"] } },
    select: { id: true, restricaoIdade: true },
  });
  if (found.length !== uniqueIds.length)
    throw new Error("Algum item é inválido. Recarregue e tente de novo.");
  const restricaoIdade = marcadoIdade || found.some((p) => p.restricaoIdade);
  return { restricaoIdade };
}

export async function createCombo(input: ComboInput) {
  return tx(async (tid) => {
    const d = comboSchema.parse(input);

    const sub = d.subcategoryId
      ? await db.subcategory.findFirst({
          where: { id: d.subcategoryId },
          include: { category: true },
        })
      : null;

    const { restricaoIdade } = await validateComponentProducts(d.components, d.restricaoIdade);
    const sku = await generateSku(sub?.category.skuPrefix ?? "KIT", sub?.skuPrefix ?? "CMB");
    const brandId = await resolveBrandId(tid, d.brandId, d.marcaNome);

    await assertCabeProduto(tid);
    const product = await db.product.create({
      data: {
        tenantId: tid,
        tipo: "COMBO",
        nome: d.nome.trim(),
        sku,
        subcategoryId: (d.subcategoryId ?? null) as string, // nullable após db:push
        brandId,
        imagemUrl: d.imagemUrl || null,
        unidadeBase: "UN",
        precoVenda: d.precoVenda ?? null,
        // custo do combo é derivado dos componentes — não persiste.
        fiscalProfileId: d.fiscalProfileId ?? sub?.defaultFiscalProfileId ?? null,
        restricaoIdade,
        vendeOnline: d.vendeOnline,
        pesoGramas: d.pesoGramas ?? null,
        alturaCm: d.alturaCm ?? null,
        larguraCm: d.larguraCm ?? null,
        comprimentoCm: d.comprimentoCm ?? null,
        descricaoOnline: d.descricaoOnline || null,
        components: {
          create: d.components.map((c) => ({
            tenantId: tid,
            componentProductId: c.componentProductId,
            quantidade: c.quantidade,
            unidade: "UN" as const,
          })),
        },
      },
    });

    if (d.tags?.length) await attachTags(tid, product.id, d.tags);
    await syncSalesChannels(tid, product.id, d.salesChannels);

    ok();
    return { id: product.id, sku };
  });
}

export async function updateCombo(id: string, input: ComboInput) {
  return tx(async (tid) => {
    const d = comboSchema.parse(input);
    const { restricaoIdade } = await validateComponentProducts(d.components, d.restricaoIdade);
    const brandId = await resolveBrandId(tid, d.brandId, d.marcaNome);

    await db.product.update({
      where: { id },
      data: {
        nome: d.nome.trim(),
        subcategoryId: (d.subcategoryId ?? null) as string, // nullable após db:push
        brandId,
        imagemUrl: d.imagemUrl || null,
        precoVenda: d.precoVenda ?? null,
        fiscalProfileId: d.fiscalProfileId ?? null,
        restricaoIdade,
        vendeOnline: d.vendeOnline,
        pesoGramas: d.pesoGramas ?? null,
        alturaCm: d.alturaCm ?? null,
        larguraCm: d.larguraCm ?? null,
        comprimentoCm: d.comprimentoCm ?? null,
        descricaoOnline: d.descricaoOnline || null,
      },
    });

    // Sincroniza componentes: substitui o conjunto (delete + recreate).
    await db.productComponent.deleteMany({ where: { parentProductId: id } });
    await db.productComponent.createMany({
      data: d.components.map((c) => ({
        tenantId: tid,
        parentProductId: id,
        componentProductId: c.componentProductId,
        quantidade: c.quantidade,
        unidade: "UN" as const,
      })),
    });

    await syncSalesChannels(tid, id, d.salesChannels);
    ok();
  });
}

// ── Personalizados / Receitas (DRINK/PRATO/OUTRO) ──────────
const receitaComponentSchema = z.object({
  componentProductId: z.string().min(1),
  quantidade: z.number().positive(),
  unidade: z.enum(["UN", "ML", "G"]),
});

const receitaGroupItemSchema = z.object({
  componentProductId: z.string().min(1),
  quantidade: z.number().positive(),
  unidade: z.enum(["UN", "ML", "G"]),
  isDefault: z.boolean().default(false),
  acrescimoPreco: z.number().nonnegative().optional().nullable(),
});

const receitaGroupSchema = z.object({
  nome: z.string().min(1, "Informe o nome do grupo."),
  obrigatoria: z.boolean().default(true),
  tipoSelecao: z.enum(["UNICA", "MULTIPLA"]).default("UNICA"),
  maxSelecoes: z.number().int().positive().optional().nullable(),
  ordem: z.number().int().default(0),
  items: z.array(receitaGroupItemSchema).min(1, "Cada grupo precisa de ao menos um item."),
});

const receitaVariantSchema = z.object({
  nome: z.string().min(1),
  volumeMl: z.number().positive().optional().nullable(),
  fatorEscala: z.number().positive().default(1),
  precoVenda: z.number().nonnegative().optional().nullable(),
  isDefault: z.boolean().default(false),
});

const receitaSchema = z.object({
  nome: z.string().min(2, "Informe o nome da receita."),
  ean: z.string().optional(),
  subcategoryId: z.string().min(1, "Escolha a subcategoria."),
  brandId: z.string().optional().nullable(),
  marcaNome: z.string().optional(),
  imagemUrl: z.string().optional(),
  precoVenda: z.number().nonnegative().optional().nullable(),
  fiscalProfileId: z.string().optional().nullable(),
  restricaoIdade: z.boolean().default(false),
  tipoReceita: z.enum(["DRINK", "PRATO", "OUTRO"]),
  copoMl: z.number().positive().optional().nullable(),
  modoPreparo: z.string().optional(),
  vendeOnline: z.boolean().default(false),
  pesoGramas: z.number().int().positive().optional().nullable(),
  alturaCm: z.number().positive().optional().nullable(),
  larguraCm: z.number().positive().optional().nullable(),
  comprimentoCm: z.number().positive().optional().nullable(),
  descricaoOnline: z.string().optional(),
  tags: z.array(z.string()).optional(),
  components: z.array(receitaComponentSchema).optional().default([]),
  groups: z.array(receitaGroupSchema).optional().default([]),
  variants: z.array(receitaVariantSchema).optional().default([]),
  salesChannels: z.array(salesChannelSchema).optional().default([]),
});

export type ReceitaInput = z.input<typeof receitaSchema>;

/**
 * Normaliza as variações: nomes únicos e exatamente uma `isDefault` (se houver).
 * Devolve [] quando a receita é de tamanho único.
 */
function normalizeVariants(variants: z.infer<typeof receitaVariantSchema>[]) {
  if (variants.length === 0) return [];
  const nomes = new Set<string>();
  for (const v of variants) {
    const nome = v.nome.trim().toUpperCase();
    if (nomes.has(nome)) throw new Error(`Tamanho «${v.nome}» repetido.`);
    nomes.add(nome);
  }
  const temDefault = variants.some((v) => v.isDefault);
  return variants.map((v, idx) => ({
    nome: v.nome.trim(),
    volumeMl: v.volumeMl ?? null,
    fatorEscala: v.fatorEscala,
    precoVenda: v.precoVenda ?? null,
    isDefault: temDefault ? v.isDefault : idx === 0,
  }));
}

export async function createReceita(input: ReceitaInput) {
  return tx(async (tid) => {
    const d = receitaSchema.parse(input);

    const sub = await db.subcategory.findFirst({
      where: { id: d.subcategoryId },
      include: { category: true },
    });
    if (!sub) throw new Error("Subcategoria inválida.");

    const { restricaoIdade } = await validateComponentProducts(
      d.components,
      d.restricaoIdade,
      d.groups.map((g) => g.items),
    );
    const sku = await generateSku(sub.category.skuPrefix, sub.skuPrefix);
    const brandId = await resolveBrandId(tid, d.brandId, d.marcaNome);

    await assertCabeProduto(tid);
    const product = await db.product.create({
      data: {
        tenantId: tid,
        tipo: "PERSONALIZADO",
        nome: d.nome.trim(),
        ean: d.ean ? onlyDigits(d.ean) : null,
        sku,
        subcategoryId: d.subcategoryId,
        brandId,
        imagemUrl: d.imagemUrl || null,
        unidadeBase: "UN",
        precoVenda: d.precoVenda ?? null,
        fiscalProfileId: d.fiscalProfileId ?? sub.defaultFiscalProfileId ?? null,
        restricaoIdade,
        tipoReceita: d.tipoReceita,
        copoMl: d.tipoReceita === "DRINK" ? d.copoMl ?? null : null,
        modoPreparo: d.modoPreparo?.trim() || null,
        vendeOnline: d.vendeOnline,
        pesoGramas: d.pesoGramas ?? null,
        alturaCm: d.alturaCm ?? null,
        larguraCm: d.larguraCm ?? null,
        comprimentoCm: d.comprimentoCm ?? null,
        descricaoOnline: d.descricaoOnline || null,
        components: {
          create: d.components.map((c) => ({
            tenantId: tid,
            componentProductId: c.componentProductId,
            quantidade: c.quantidade,
            unidade: c.unidade,
          })),
        },
      },
    });

    // Cria grupos e seus itens
    for (const group of d.groups) {
      const g = await db.productComponentGroup.create({
        data: {
          tenantId: tid,
          parentProductId: product.id,
          nome: group.nome.trim(),
          obrigatoria: group.obrigatoria,
          tipoSelecao: group.tipoSelecao,
          maxSelecoes: group.maxSelecoes ?? null,
          ordem: group.ordem,
        },
      });
      await db.productComponent.createMany({
        data: group.items.map((item) => ({
          tenantId: tid,
          parentProductId: product.id,
          componentProductId: item.componentProductId,
          quantidade: item.quantidade,
          unidade: item.unidade,
          groupId: g.id,
          isDefault: item.isDefault,
          acrescenta: (item.acrescimoPreco ?? 0) > 0,
          acrescimoPreco: item.acrescimoPreco ?? null,
        })),
      });
    }

    const variants = normalizeVariants(d.variants);
    if (variants.length) {
      await db.productVariant.createMany({
        data: variants.map((v) => ({ tenantId: tid, productId: product.id, ...v })),
      });
    }

    if (d.tags?.length) await attachTags(tid, product.id, d.tags);
    await syncSalesChannels(tid, product.id, d.salesChannels);

    ok();
    return { id: product.id, sku };
  });
}

export async function updateReceita(id: string, input: ReceitaInput) {
  return tx(async (tid) => {
    const d = receitaSchema.parse(input);
    const { restricaoIdade } = await validateComponentProducts(
      d.components,
      d.restricaoIdade,
      d.groups.map((g) => g.items),
    );
    const brandId = await resolveBrandId(tid, d.brandId, d.marcaNome);

    await db.product.update({
      where: { id },
      data: {
        nome: d.nome.trim(),
        ean: d.ean ? onlyDigits(d.ean) : null,
        subcategoryId: d.subcategoryId,
        brandId,
        imagemUrl: d.imagemUrl || null,
        precoVenda: d.precoVenda ?? null,
        fiscalProfileId: d.fiscalProfileId ?? null,
        restricaoIdade,
        tipoReceita: d.tipoReceita,
        copoMl: d.tipoReceita === "DRINK" ? d.copoMl ?? null : null,
        modoPreparo: d.modoPreparo?.trim() || null,
        vendeOnline: d.vendeOnline,
        pesoGramas: d.pesoGramas ?? null,
        alturaCm: d.alturaCm ?? null,
        larguraCm: d.larguraCm ?? null,
        comprimentoCm: d.comprimentoCm ?? null,
        descricaoOnline: d.descricaoOnline || null,
      },
    });

    // Limpa tudo: componentes (incluindo os de grupos via cascade) e grupos
    await db.productComponent.deleteMany({ where: { parentProductId: id } });
    await db.productComponentGroup.deleteMany({ where: { parentProductId: id } });

    // Recria componentes soltos (legado / sem grupo)
    if (d.components.length > 0) {
      await db.productComponent.createMany({
        data: d.components.map((c) => ({
          tenantId: tid,
          parentProductId: id,
          componentProductId: c.componentProductId,
          quantidade: c.quantidade,
          unidade: c.unidade,
        })),
      });
    }

    // Recria grupos e seus itens
    for (const group of d.groups) {
      const g = await db.productComponentGroup.create({
        data: {
          tenantId: tid,
          parentProductId: id,
          nome: group.nome.trim(),
          obrigatoria: group.obrigatoria,
          tipoSelecao: group.tipoSelecao,
          maxSelecoes: group.maxSelecoes ?? null,
          ordem: group.ordem,
        },
      });
      await db.productComponent.createMany({
        data: group.items.map((item) => ({
          tenantId: tid,
          parentProductId: id,
          componentProductId: item.componentProductId,
          quantidade: item.quantidade,
          unidade: item.unidade,
          groupId: g.id,
          isDefault: item.isDefault,
          acrescenta: (item.acrescimoPreco ?? 0) > 0,
          acrescimoPreco: item.acrescimoPreco ?? null,
        })),
      });
    }

    // Sincroniza variações: substitui o conjunto.
    await db.productVariant.deleteMany({ where: { productId: id } });
    const variants = normalizeVariants(d.variants);
    if (variants.length) {
      await db.productVariant.createMany({
        data: variants.map((v) => ({ tenantId: tid, productId: id, ...v })),
      });
    }

    await syncSalesChannels(tid, id, d.salesChannels);
    ok();
  });
}

// ── Enriquecimento por EAN (Cosmos + LLM) ──────────────────
export type EanMotivo =
  | "invalido"
  | "ja_cadastrado"
  | "nao_encontrado"
  | "rate_limit"
  | "sem_token"
  | "erro";

export type EanSuggestion = {
  encontrado: boolean;
  fonte: "cosmos+llm" | "cosmos" | "nenhuma";
  /** Quando não encontrado, por quê — usado p/ escolher a notificação no cliente. */
  motivo?: EanMotivo;
  /** Produto já existente com esse EAN (quando motivo = ja_cadastrado). */
  produtoExistente?: { id: string; nome: string; sku: string };
  nome?: string;
  marcaNome?: string;
  subcategoryId?: string | null;
  fiscalDica?: string;
  ncm?: string | null;
  cest?: string | null;
  pesoGramas?: number | null;
  alturaCm?: number | null;
  larguraCm?: number | null;
  comprimentoCm?: number | null;
  imagemUrl?: string | null;
  restricaoIdade?: boolean;
  erro?: string;
};

export async function enrichEan(eanRaw: string): Promise<EanSuggestion> {
  return tx(async () => {
    const ean = onlyDigits(eanRaw);
    if (ean.length < 8)
      return {
        encontrado: false,
        fonte: "nenhuma",
        motivo: "invalido",
        erro: "Código de barras inválido. Precisa ter ao menos 8 dígitos.",
      };

    // Antes de consultar fora: já existe produto com esse EAN neste tenant?
    const existente = await db.product.findFirst({
      where: { ean },
      select: { id: true, nome: true, sku: true },
    });
    if (existente)
      return {
        encontrado: false,
        fonte: "nenhuma",
        motivo: "ja_cadastrado",
        produtoExistente: existente,
        erro: `Já cadastrado: ${existente.nome} (${existente.sku}).`,
      };

    let cosmos;
    try {
      cosmos = await getCosmosByEan(ean);
    } catch (e) {
      if (e instanceof CosmosError) {
        const motivo: EanMotivo =
          e.code === "NOT_FOUND"
            ? "nao_encontrado"
            : e.code === "RATE_LIMIT"
              ? "rate_limit"
              : e.code === "NO_TOKEN"
                ? "sem_token"
                : "erro";
        const msg =
          e.code === "NOT_FOUND"
            ? "Código não encontrado. Preencha manualmente."
            : e.code === "RATE_LIMIT"
              ? "Limite de consultas atingido. Tente mais tarde ou preencha à mão."
              : e.code === "NO_TOKEN"
                ? "Busca por código indisponível (sem token). Preencha à mão."
                : "Não foi possível consultar agora.";
        return { encontrado: false, fonte: "nenhuma", motivo, erro: msg };
      }
      throw e;
    }

    const base: EanSuggestion = {
      encontrado: true,
      fonte: "cosmos",
      nome: cosmos.descricao ?? undefined,
      marcaNome: cosmos.marca ?? undefined,
      ncm: cosmos.ncm,
      cest: cosmos.cest,
      pesoGramas: cosmos.pesoLiquidoG ?? cosmos.pesoBrutoG ?? null,
      alturaCm: cosmos.alturaCm,
      larguraCm: cosmos.larguraCm,
      comprimentoCm: cosmos.comprimentoCm,
      imagemUrl: cosmos.thumbnail,
      subcategoryId: null,
    };

    if (!llmConfigured()) return base;

    const [subs, brands] = await Promise.all([
      db.subcategory.findMany({
        select: { id: true, nome: true, category: { select: { nome: true } } },
      }),
      db.brand.findMany({ select: { nome: true } }),
    ]);

    try {
      const suggestion = await completeJson<{
        nome: string;
        subcategoriaId: string | null;
        marca: string;
        dicaFiscal: string;
        restricaoIdade: boolean;
      }>({
        system:
          "Você normaliza dados de produtos de mercado de bebidas no Brasil. " +
          "Responda SOMENTE com JSON válido, sem texto extra. Use exatamente as opções fornecidas.",
        user: JSON.stringify({
          instrucao:
            "A partir do JSON do produto, devolva: nome (limpo, sem códigos), " +
            "subcategoriaId (escolha o id mais adequado da lista ou null), " +
            "marca (nome da marca; pode ser uma das existentes), " +
            "dicaFiscal (frase curta sobre NCM/CEST), " +
            "restricaoIdade (true se o produto exige maioridade — bebida alcoólica, cigarro, tabaco, vape, energético alcóolico; false caso contrário).",
          formato: { nome: "string", subcategoriaId: "string|null", marca: "string", dicaFiscal: "string", restricaoIdade: "boolean" },
          produto: cosmos.raw,
          subcategorias: subs.map((s) => ({ id: s.id, nome: `${s.category.nome} › ${s.nome}` })),
          marcasExistentes: brands.map((b) => b.nome),
        }),
      });

      return {
        ...base,
        fonte: "cosmos+llm",
        nome: suggestion.nome || base.nome,
        marcaNome: suggestion.marca || base.marcaNome,
        subcategoryId:
          suggestion.subcategoriaId && subs.some((s) => s.id === suggestion.subcategoriaId)
            ? suggestion.subcategoriaId
            : null,
        fiscalDica: suggestion.dicaFiscal,
        restricaoIdade: suggestion.restricaoIdade === true,
      };
    } catch {
      return base;
    }
  });
}
