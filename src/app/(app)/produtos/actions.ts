"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db, basePrisma, comTenant } from "@/lib/prisma";
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
import { invalidarOpcoesFiltro } from "./_query";
import { invalidarOpcoesFormulario } from "./_data";
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

/**
 * Local de armazenagem alimenta o select do cadastro de produto — por isso
 * derruba também o cache das opções do formulário. Sem isso o operador cria o
 * local e ele não aparece no produto seguinte.
 */
const okStorage = (tid: string) => {
  revalidatePath("/produtos");
  revalidatePath("/configuracoes/sites");
  revalidatePath("/estoque");
  invalidarOpcoesFormulario(tid);
};

/**
 * Como `ok()`, mas também derruba o cache das opções de filtro.
 *
 * Separado de propósito: salvar produto é a escrita mais comum da tela e não
 * mexe em categoria/marca/etiqueta. Se `ok()` invalidasse tudo, o cache viveria
 * segundos e não serviria para nada.
 */
const okOpcoes = (tid: string) => {
  ok();
  invalidarOpcoesFiltro(tid);
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
    okOpcoes(tid);
    return { id: brand.id, nome: brand.nome, jaExistia: false };
  });
}

export async function updateBrand(input: { id: string; nome: string }) {
  return tx(async (tid) => {
    const nome = input.nome.trim();
    if (nome.length < 2) throw new Error("Informe o nome da marca.");
    const nomeNormalizado = normalizeBrand(nome);
    const dup = await db.brand.findFirst({
      where: { nomeNormalizado, id: { not: input.id } },
    });
    if (dup) throw new Error(`Já existe a marca «${dup.nome}».`);
    await db.brand.update({ where: { id: input.id }, data: { nome, nomeNormalizado } });
    okOpcoes(tid);
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
    okOpcoes(tid);
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
    okOpcoes(tid);
    return sub.id;
  });
}

export async function updateSubcategory(input: { id: string; nome: string }) {
  return tx(async (tid) => {
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
    okOpcoes(tid);
  });
}

export async function setSubcategoryActive(id: string, ativo: boolean) {
  return tx(async (tid) => {
    await db.subcategory.update({ where: { id }, data: { ativo } });
    okOpcoes(tid);
  });
}

// ── Armazenagem ────────────────────────────────────────────
/**
 * Estabelecimentos do tenant, só o suficiente para escolher onde nasce um
 * local de estoque. O cadastro de produto cria local sem sair da tela — e para
 * isso precisa saber se há uma loja ou cinco.
 */
export async function sitesParaLocal(): Promise<{ id: string; nome: string }[]> {
  return tx(async () => {
    const sites = await db.site.findMany({
      where: { ativo: true },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    });
    return sites;
  });
}

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
    okStorage(tid);
    return loc.id;
  });
}

export async function updateStorageLocation(
  id: string,
  input: { nome: string; tipo: StorageType; siteId: string },
) {
  return tx(async (tid) => {
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
    okStorage(tid);
  });
}

export async function deleteStorageLocation(id: string) {
  return tx(async (tid) => {
    const hasStock = await db.stock.findFirst({ where: { locationId: id } });
    if (hasStock)
      throw new Error(
        "Não é possível excluir: há produtos vinculados a este local. Inative-o.",
      );
    await db.storageLocation.delete({ where: { id } });
    okStorage(tid);
  });
}

export async function toggleStorageLocationAtivo(id: string, ativo: boolean) {
  return tx(async (tid) => {
    await db.storageLocation.update({ where: { id }, data: { ativo } });
    okStorage(tid);
  });
}

// ── Fornecedores ───────────────────────────────────────────
// Cadastro de fornecedor é assunto de fornecedor, não de produto: o guard é
// `fornecedor.editar` (o perfil FINANCEIRO tem essa permissão e não tem
// `produto.editar` — com o guard antigo ele não conseguia salvar). As funções
// continuam aqui porque o cadastro rápido dentro do produto usa as mesmas.
async function txFornecedor<T>(fn: (tid: string) => Promise<T>): Promise<T> {
  const ctx = await guardAction("fornecedor.editar");
  return runWithTenant(ctx.tenant.id, () => fn(ctx.tenant.id));
}

/** Toda tela que lê fornecedor: lista, centro de gestão, produtos e compras. */
function okFornecedor(tid: string) {
  revalidatePath("/fornecedores", "layout");
  revalidatePath("/produtos");
  revalidatePath("/cotacoes", "layout");
  revalidatePath("/pedidos", "layout");
  // O picker de fornecedor do cadastro de produto vem de cache.
  invalidarOpcoesFormulario(tid);
}

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
  return txFornecedor(async (tid) => {
    const d = supplierSchema.parse(input);
    const data = supplierData(d);
    if (data.cnpj) {
      const dup = await db.supplier.findFirst({ where: { cnpj: data.cnpj } });
      if (dup) throw new Error(`Já existe um fornecedor com esse CNPJ: «${dup.nomeFantasia || dup.razaoSocial}».`);
    }
    const sup = await db.supplier.create({ data: { tenantId: tid, ...data } });

    // Fornecedor novo com telefone/e-mail já nasce com o contato principal:
    // é ele que a cotação usa, e cadastro rápido não abre a aba Contatos.
    if (data.telefone || data.email) {
      await db.supplierContact.create({
        data: {
          tenantId: tid,
          supplierId: sup.id,
          nome: data.nomeContatoPrincipal || data.nomeFantasia || data.razaoSocial,
          telefone: data.telefone,
          email: data.email,
          principal: true,
        },
      });
    }

    okFornecedor(tid);
    return sup.id;
  });
}

export async function updateSupplier(id: string, input: z.input<typeof supplierSchema>) {
  return txFornecedor(async (tid) => {
    const d = supplierSchema.parse(input);
    const data = supplierData(d);
    if (data.cnpj) {
      const dup = await db.supplier.findFirst({ where: { cnpj: data.cnpj, id: { not: id } } });
      if (dup) throw new Error(`Já existe um fornecedor com esse CNPJ: «${dup.nomeFantasia || dup.razaoSocial}».`);
    }
    await db.supplier.update({ where: { id }, data });
    okFornecedor(tid);
  });
}

export async function setSupplierActive(id: string, ativo: boolean) {
  return txFornecedor(async (tid) => {
    await db.supplier.update({ where: { id }, data: { ativo } });
    okFornecedor(tid);
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

/** Lista de fornecedores efetiva: usa fornecedoresIds; cai no principal legado se vazia. */
function resolveFornecedores(d: {
  fornecedoresIds: string[];
  fornecedorPrincipalId?: string | null;
}): string[] {
  if (d.fornecedoresIds.length) return d.fornecedoresIds;
  return d.fornecedorPrincipalId ? [d.fornecedorPrincipalId] : [];
}

/**
 * Substitui o conjunto de fornecedores do produto. O primeiro da lista vira o
 * principal. `custoFornecedor` (se informado) fica no principal.
 */
async function syncSuppliers(
  tid: string,
  productId: string,
  fornecedoresIds: string[],
  custoFornecedor: number | null | undefined,
) {
  // Dedup preservando a ordem (o primeiro é o principal).
  const ids = fornecedoresIds.filter((id, i) => id && fornecedoresIds.indexOf(id) === i);
  await db.productSupplier.deleteMany({ where: { productId } });
  if (ids.length) {
    await db.productSupplier.createMany({
      data: ids.map((supplierId, i) => ({
        tenantId: tid,
        productId,
        supplierId,
        custoFornecedor: i === 0 ? custoFornecedor ?? null : null,
        isPrincipal: i === 0,
      })),
    });
  }
}

/**
 * Nenhum código de barras pode responder por duas coisas.
 *
 * Não é preciosismo de cadastro: o EAN é a CHAVE de entrada do sistema inteiro
 * — o PDV bipa e vende, o XML da NF-e casa a linha com o produto, a etiqueta
 * imprime. Dois produtos com o mesmo código fazem o caixa vender o errado e o
 * recebimento somar saldo no produto errado, e ninguém descobre pela tela: só
 * pelo inventário que não fecha.
 *
 * Varre os três lugares onde um código vive (produto, embalagem de compra e
 * variação comercial), porque o leitor não sabe a diferença entre eles.
 */
async function assertCodigosLivres(
  codigos: (string | null | undefined)[],
  exceptProductId?: string,
) {
  const limpos = codigos
    .map((c) => (c ? onlyDigits(c) : ""))
    .filter((c) => c.length > 0);
  if (limpos.length === 0) return;

  // Colisão dentro do próprio formulário — o banco nem chega a ser consultado.
  const vistos = new Set<string>();
  for (const c of limpos) {
    if (vistos.has(c)) {
      throw new Error(
        `O código de barras ${c} está repetido neste cadastro. Cada código responde por uma coisa só.`,
      );
    }
    vistos.add(c);
  }

  const fora = exceptProductId ? { not: exceptProductId } : undefined;
  const [produto, embalagem] = await Promise.all([
    db.product.findFirst({
      where: { ean: { in: limpos }, ...(fora ? { id: fora } : {}) },
      select: { nome: true, sku: true, ean: true },
    }),
    db.productPackaging.findFirst({
      where: { ean: { in: limpos }, ...(fora ? { productId: fora } : {}) },
      select: { nome: true, ean: true, product: { select: { nome: true, sku: true } } },
    }),
  ]);

  if (produto) {
    throw new Error(
      `O código de barras ${produto.ean} já é de "${produto.nome}" (${produto.sku}).`,
    );
  }
  if (embalagem) {
    throw new Error(
      `O código de barras ${embalagem.ean} já é da embalagem "${embalagem.nome}" de "${embalagem.product.nome}" (${embalagem.product.sku}).`,
    );
  }
}

/**
 * Substitui o conjunto de embalagens de compra do produto PRESERVANDO os ids
 * das que continuam existindo.
 *
 * Isto não é detalhe de implementação: `ProductPackaging.id` é referência solta
 * (sem FK) em cotação, pedido, recebimento e devolução — `QuotationItem.
 * packagingId`, `PurchaseOrderItem.packagingId` e companhia. Enquanto isto era
 * delete + recreate, salvar o cadastro por qualquer motivo (trocar a FOTO,
 * mexer no preço) dava ids novos às mesmas embalagens, e toda cotação aberta
 * perdia a embalagem pedida em silêncio: o item que era "3 × Caixa (12 un.)"
 * aparecia para o fornecedor como "3 unidades", ou seja, com o preço errado.
 *
 * O casamento é por código de barras primeiro (DUN é identidade de verdade) e
 * por nome depois — as duas coisas que o operador reconhece como "a mesma
 * embalagem". Só o que sumiu da lista é apagado.
 */
async function syncPackagings(
  tid: string,
  productId: string,
  packagings: { nome: string; ean?: string | null; fatorConversao: number }[],
) {
  const atuais = await db.productPackaging.findMany({
    where: { productId },
    select: { id: true, nome: true, ean: true },
  });

  const porEan = new Map<string, string>();
  const porNome = new Map<string, string>();
  for (const a of atuais) {
    if (a.ean) porEan.set(a.ean, a.id);
    porNome.set(a.nome.trim().toLowerCase(), a.id);
  }

  const aproveitados = new Set<string>();
  const novas: { nome: string; ean: string | null; fatorConversao: number; ordem: number }[] = [];
  const atualizacoes: Promise<unknown>[] = [];

  packagings.forEach((pk, i) => {
    const nome = pk.nome.trim();
    const ean = pk.ean ? onlyDigits(pk.ean) : null;
    // Uma embalagem já aproveitada não casa de novo: duas linhas com o mesmo
    // nome viram uma reaproveitada e uma nova, nunca duas apontando ao mesmo id.
    const candidato = (ean && porEan.get(ean)) || porNome.get(nome.toLowerCase()) || null;
    const id = candidato && !aproveitados.has(candidato) ? candidato : null;

    if (id) {
      aproveitados.add(id);
      atualizacoes.push(
        db.productPackaging.updateMany({
          where: { id },
          data: { nome, ean, fatorConversao: pk.fatorConversao, isCompraDefault: i === 0 },
        }),
      );
    } else {
      novas.push({ nome, ean, fatorConversao: pk.fatorConversao, ordem: i });
    }
  });

  const removidas = atuais.filter((a) => !aproveitados.has(a.id)).map((a) => a.id);

  if (removidas.length) {
    await db.productPackaging.deleteMany({ where: { id: { in: removidas } } });
  }
  await Promise.all(atualizacoes);
  if (novas.length) {
    await db.productPackaging.createMany({
      data: novas.map((pk) => ({
        tenantId: tid,
        productId,
        nome: pk.nome,
        ean: pk.ean,
        fatorConversao: pk.fatorConversao,
        isCompraDefault: pk.ordem === 0,
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

  // Utilização do produto — as duas convivem: vende a unidade fechada no PDV
  // e/ou rende dose em drink/receita.
  unidadeBase: z.enum(["UN", "ML", "G"]).default("UN"),
  vendaUnidade: z.boolean().default(true),
  fracionavel: z.boolean().default(false),
  conteudoPorUnidade: z.number().positive().optional().nullable(),
  dosePadrao: z.number().positive().optional().nullable(),

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
  // Lista completa de fornecedores — o primeiro vira o principal. Mantém
  // fornecedorPrincipalId por compatibilidade (fallback quando a lista vem vazia).
  fornecedoresIds: z.array(z.string()).optional().default([]),

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
  // Marca nascida de dentro do cadastro de produto conta igual: entra na lista
  // do filtro. Invalidar aqui cobre todos os chamadores de uma vez.
  invalidarOpcoesFiltro(tid);
  return created.id;
}

export async function createProduct(input: ProductInput) {
  return tx(async (tid) => {
    const d = productSchema.parse(input);
    const skuVal = d.sku?.trim() ? d.sku.trim().toUpperCase() : undefined;

    // 4 leituras independentes — sem isso, cada uma é um round-trip sequencial
    // ao Neon (latência soma). Rodando junto, o tempo de espera é o da mais lenta.
    const [sub, skuConflict, brandId, site] = await Promise.all([
      db.subcategory.findFirst({
        where: { id: d.subcategoryId },
        include: { category: true },
      }),
      skuVal
        ? db.product.findFirst({ where: { sku: skuVal }, select: { id: true } })
        : Promise.resolve(null),
      resolveBrandId(tid, d.brandId, d.marcaNome),
      getOrCreateDefaultSite(tid),
      assertCabeProduto(tid),
    ]);
    if (!sub) throw new Error("Subcategoria inválida.");
    if (skuVal && skuConflict) throw new Error(`SKU "${skuVal}" já está em uso.`);
    await assertCodigosLivres([
      d.ean,
      ...(d.packagings ?? []).map((pk) => pk.ean),
    ]);
    const sku = skuVal ?? (await generateSku(sub.category.skuPrefix, sub.skuPrefix));

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
        vendaUnidade: d.vendaUnidade,
        fracionavel: d.fracionavel,
        conteudoPorUnidade: d.conteudoPorUnidade ?? null,
        dosePadrao: d.fracionavel ? d.dosePadrao ?? null : null,
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
            siteId: site.id,
            estoqueFechado: d.estoqueInicial,
            estoqueMinimo: d.estoqueMinimo,
            estoqueIdeal: d.estoqueIdeal,
            locationId: d.locationId ?? null,
          }],
        },
      },
    });

    // Tabelas diferentes, sem dependência entre si — mesma lógica do ganho acima.
    await Promise.all([
      d.tags?.length ? attachTags(tid, product.id, d.tags) : Promise.resolve(),
      syncSalesChannels(tid, product.id, d.salesChannels),
      syncPackagings(tid, product.id, d.packagings),
      syncSuppliers(tid, product.id, resolveFornecedores(d), d.custoFornecedor),
    ]);

    ok();
    return { id: product.id, sku };
  });
}

export async function updateProduct(id: string, input: ProductInput) {
  return tx(async (tid) => {
    const d = productSchema.parse(input);
    const skuVal = d.sku?.trim() ? d.sku.trim().toUpperCase() : undefined;

    const [brandId, skuConflict] = await Promise.all([
      resolveBrandId(tid, d.brandId, d.marcaNome),
      skuVal
        ? db.product.findFirst({ where: { sku: skuVal, id: { not: id } }, select: { id: true } })
        : Promise.resolve(null),
    ]);
    if (skuVal && skuConflict) throw new Error(`SKU "${skuVal}" já está em uso.`);
    await assertCodigosLivres(
      [d.ean, ...(d.packagings ?? []).map((pk) => pk.ean)],
      id,
    );
    const skuData = skuVal ? { sku: skuVal } : {};

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
        vendaUnidade: d.vendaUnidade,
        fracionavel: d.fracionavel,
        conteudoPorUnidade: d.conteudoPorUnidade ?? null,
        dosePadrao: d.fracionavel ? d.dosePadrao ?? null : null,
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
    // 4 tabelas diferentes, sem dependência entre si — concorrente em vez de
    // sequencial (cada sync ainda é delete+create por dentro, mas em paralelo
    // com os outros 3).
    await Promise.all([
      db.stock.updateMany({
        where: { productId: id },
        data: {
          estoqueMinimo: d.estoqueMinimo,
          estoqueIdeal: d.estoqueIdeal,
          locationId: d.locationId ?? null,
        },
      }),
      syncSalesChannels(tid, id, d.salesChannels),
      syncPackagings(tid, id, d.packagings),
      syncSuppliers(tid, id, resolveFornecedores(d), d.custoFornecedor),
    ]);
    ok();
  });
}

// ── Complemento: compra e fiscal fora do cadastro ──────────
//
// O cadastro de produto simples pergunta só o que o operador sabe. Embalagem
// de compra, fornecedor, variação comercial e classificação fiscal chegam
// sozinhos no XML da primeira nota (`enriquecerProdutoComNota`) — mas produto
// que nunca recebeu nota ficaria sem nada disso para sempre. Esta action é a
// porta manual: mexe SÓ nesses campos e não encosta em nome, preço, categoria
// nem estoque, então abrir o painel e salvar nunca pode desfazer o cadastro.
const complementoSchema = z.object({
  fiscalProfileId: z.string().optional().nullable(),
  gtinTributavel: z.string().optional().nullable(),
  unidadeTributavel: z.string().optional().nullable(),
  fatorConversaoTrib: z.number().positive().optional().nullable(),
  codigoAnp: z.string().optional().nullable(),

  fornecedoresIds: z.array(z.string()).default([]),

  packagings: z
    .array(
      z.object({
        nome: z.string().min(1, "Informe o nome da embalagem."),
        ean: z.string().optional().nullable(),
        fatorConversao: z.number().positive("Informe quantas unidades a embalagem contém."),
      }),
    )
    .default([]),

});

export type ComplementoInput = z.input<typeof complementoSchema>;

export async function atualizarComplementoProduto(id: string, input: ComplementoInput) {
  return tx(async (tid) => {
    const d = complementoSchema.parse(input);

    // Código de barras é chave de bipe: um DUN de fardo repetido em dois
    // produtos faz o PDV escolher um deles ao acaso.
    await assertCodigosLivres(
      d.packagings.map((pk) => pk.ean),
      id,
    );

    await db.product.update({
      where: { id },
      data: {
        fiscalProfileId: d.fiscalProfileId || null,
        gtinTributavel: d.gtinTributavel || null,
        unidadeTributavel: d.unidadeTributavel?.trim().toUpperCase() || null,
        fatorConversaoTrib: d.fatorConversaoTrib ?? null,
        codigoAnp: d.codigoAnp || null,
      },
    });

    await Promise.all([
      syncPackagings(tid, id, d.packagings),
      // `undefined` no custo: quem define preço de compra é a nota, não este
      // painel — passar 0 aqui apagaria o histórico do comparador.
      syncSuppliers(tid, id, d.fornecedoresIds, undefined),
    ]);
    ok();
  });
}

export async function archiveProduct(id: string, ativo: boolean) {
  return tx(async () => {
    await db.product.update({ where: { id }, data: { ativo } });
    ok();
  });
}

/** Ativa/inativa vários produtos de uma vez (ação em lote da listagem). */
export async function bulkArchiveProducts(ids: string[], ativo: boolean) {
  return tx(async () => {
    if (ids.length === 0) return;
    await db.product.updateMany({ where: { id: { in: ids } }, data: { ativo } });
    ok();
  });
}

/** Renomeia vários produtos de uma vez (painel de nomes da listagem). */
export async function bulkRenameProducts(
  items: { id: string; nome: string }[],
) {
  return tx(async () => {
    const validos = items
      .map((i) => ({ id: i.id, nome: i.nome.trim() }))
      .filter((i) => i.nome.length >= 2);
    if (!validos.length) return 0;
    await Promise.all(
      validos.map((i) =>
        db.product.update({ where: { id: i.id }, data: { nome: i.nome } }),
      ),
    );
    ok();
    return validos.length;
  });
}

// ── Edição em lote (listagem) ──────────────────────────────
const bulkEditSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Selecione ao menos um produto."),
  /** Ausente = campo não é tocado. */
  subcategoryId: z.string().min(1).optional(),
  /** Ausente = não toca; `null` = tira a marca do produto. */
  brandId: z.string().min(1).nullable().optional(),
  /** Marca nova pelo nome — cria (ou reaproveita a existente) e ganha do brandId. */
  marcaNome: z.string().optional(),
  /** Reprecificação: % sobre o preço atual, valor somado ou preço fixo. */
  preco: z
    .object({
      modo: z.enum(["percentual", "valor", "fixo"]),
      valor: z.number().finite(),
      arredondar: z.enum(["nenhum", "90", "99", "inteiro"]).default("nenhum"),
    })
    .optional(),
  vendeOnline: z.boolean().optional(),
  /**
   * Local de armazenagem do estoque. Um local pertence a um site, então a
   * gravação alcança só o estoque daquele site. `null` = tira o local (aí
   * não há site para deduzir: limpa em todos).
   */
  locationId: z.string().min(1).nullable().optional(),
  /** `null` = tira o perfil fiscal. */
  fiscalProfileId: z.string().min(1).nullable().optional(),
  ativo: z.boolean().optional(),
  /** Etiquetas por NOME — cria a que não existir (é o jeito que o operador pensa). */
  etiquetas: z
    .object({
      modo: z.enum(["adicionar", "remover", "substituir"]),
      nomes: z.array(z.string()).default([]),
    })
    .optional(),
  fornecedores: z
    .object({
      // substituir com lista vazia = deixa o produto sem fornecedor.
      modo: z.enum(["substituir", "adicionar", "remover"]),
      ids: z.array(z.string().min(1)).default([]),
    })
    .optional(),
});

export type BulkEditInput = z.input<typeof bulkEditSchema>;

/** Estado anterior dos campos escalares tocados — combustível do "Desfazer". */
export type BulkSnapshotItem = {
  id: string;
  brandId?: string | null;
  subcategoryId?: string | null;
  precoVenda?: number | null;
  vendeOnline?: boolean;
  fiscalProfileId?: string | null;
  ativo?: boolean;
};

export type BulkEditResult = {
  alterados: number;
  /** null = não dá para desfazer (mexeu em fornecedor ou lote grande demais). */
  desfazer: BulkSnapshotItem[] | null;
};

/** Teto do snapshot de desfazer — acima disso o custo do undo passa do benefício. */
const TETO_DESFAZER = 500;

/**
 * Expressão SQL da reprecificação, montada a partir dos ENUMS validados pelo
 * Zod — nenhum texto do usuário entra na string; o número vai como bind ($1).
 *
 * Sem `Prisma.sql` aninhado de propósito: o bundler do Next pode carregar duas
 * cópias do runtime do Prisma, e aí o fragmento deixa de ser reconhecido como
 * SQL e viaja como parâmetro jsonb.
 */
function expressaoPreco(p: { modo: string; valor: number; arredondar: string }): string {
  const base =
    p.modo === "percentual"
      ? `("precoVenda" * $1)::numeric`
      : p.modo === "valor"
        ? `("precoVenda" + $1)::numeric`
        : `$1::numeric`;

  // ,90 e ,99 são a psicologia de etiqueta que o operador já usa na prateleira.
  if (p.arredondar === "inteiro") return `round(${base}, 0)`;
  if (p.arredondar === "90") return `floor(${base}) + 0.90`;
  if (p.arredondar === "99") return `floor(${base}) + 0.99`;
  return `round(${base}, 2)`;
}

/**
 * Aplica categoria/subcategoria, marca e fornecedores a vários produtos de uma
 * vez (barra de seleção da listagem). Campo ausente não é tocado — o painel
 * manda só o que o operador escolheu mexer.
 *
 * O SKU **não** é regerado ao trocar a subcategoria: ele é a etiqueta física da
 * prateleira e já está impresso/colado. Devolve quantos produtos foram alterados.
 */
export async function bulkEditProducts(input: BulkEditInput): Promise<BulkEditResult> {
  return tx(async (tid) => {
    const d = bulkEditSchema.parse(input);
    const ids = [...new Set(d.ids)];

    // Confere que os produtos são deste tenant antes de gravar qualquer coisa:
    // o extension filtra o WHERE, então a lista já volta peneirada.
    const alvos = await db.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        tipo: true,
        brandId: true,
        subcategoryId: true,
        precoVenda: true,
        vendeOnline: true,
        fiscalProfileId: true,
        ativo: true,
      },
    });
    const alvoIds = alvos.map((a) => a.id);
    if (!alvoIds.length) return { alterados: 0, desfazer: null };
    // Receita é preparo da casa: marca não se aplica, então fica de fora do lote.
    const comMarcaIds = alvos.filter((a) => a.tipo !== "PERSONALIZADO").map((a) => a.id);
    // Insumo é uso interno: reprecificação não o alcança.
    const comPrecoIds = alvos.filter((a) => a.tipo !== "INSUMO").map((a) => a.id);

    // ── Snapshot para o "Desfazer" ──
    // Fornecedor mexe em tabela de vínculo (com custo negociado por par) e o
    // local mora no Stock, não no Product: nenhum dos dois cabe num snapshot de
    // campos escalares, então esse lote não volta atrás.
    const desfazer: BulkSnapshotItem[] | null =
      d.fornecedores || d.etiquetas || d.locationId !== undefined || alvos.length > TETO_DESFAZER
        ? null
        : alvos.map((a) => ({
            id: a.id,
            ...(d.subcategoryId ? { subcategoryId: a.subcategoryId } : {}),
            ...(d.brandId !== undefined || d.marcaNome?.trim() ? { brandId: a.brandId } : {}),
            ...(d.preco ? { precoVenda: a.precoVenda?.toNumber() ?? null } : {}),
            ...(d.vendeOnline !== undefined ? { vendeOnline: a.vendeOnline } : {}),
            ...(d.fiscalProfileId !== undefined ? { fiscalProfileId: a.fiscalProfileId } : {}),
            ...(d.ativo !== undefined ? { ativo: a.ativo } : {}),
          }));

    // ── Campos escalares do produto ──
    const data: { subcategoryId?: string; vendeOnline?: boolean; ativo?: boolean } = {};
    let novaMarca: string | null | undefined;

    if (d.subcategoryId) {
      const sub = await db.subcategory.findFirst({
        where: { id: d.subcategoryId },
        select: { id: true },
      });
      if (!sub) throw new Error("Subcategoria inválida.");
      data.subcategoryId = d.subcategoryId;
    }

    if (d.marcaNome?.trim()) {
      novaMarca = await resolveBrandId(tid, null, d.marcaNome);
    } else if (d.brandId !== undefined) {
      if (d.brandId) {
        const brand = await db.brand.findFirst({
          where: { id: d.brandId },
          select: { id: true },
        });
        if (!brand) throw new Error("Marca inválida.");
      }
      novaMarca = d.brandId; // null = limpa
    }

    if (d.vendeOnline !== undefined) data.vendeOnline = d.vendeOnline;
    if (d.ativo !== undefined) data.ativo = d.ativo;

    if (Object.keys(data).length) {
      await db.product.updateMany({ where: { id: { in: alvoIds } }, data });
    }

    if (novaMarca !== undefined && comMarcaIds.length) {
      await db.product.updateMany({
        where: { id: { in: comMarcaIds } },
        data: { brandId: novaMarca },
      });
    }

    if (d.fiscalProfileId !== undefined) {
      if (d.fiscalProfileId) {
        const perfil = await db.fiscalProfile.findFirst({
          where: { id: d.fiscalProfileId },
          select: { id: true },
        });
        if (!perfil) throw new Error("Perfil fiscal inválido.");
      }
      await db.product.updateMany({
        where: { id: { in: alvoIds } },
        data: { fiscalProfileId: d.fiscalProfileId },
      });
    }

    // ── Local de armazenagem ──
    // Mora no Stock (produto × site), não no Product: por isso não entra no
    // `data` de cima. Produto sem linha de estoque no site não é criado aqui —
    // o local é onde a mercadoria fica, e ela ainda não está lá.
    if (d.locationId !== undefined) {
      let siteId: string | undefined;
      if (d.locationId) {
        const loc = await db.storageLocation.findFirst({
          where: { id: d.locationId },
          select: { siteId: true },
        });
        if (!loc) throw new Error("Local de armazenagem inválido.");
        siteId = loc.siteId;
      }
      await db.stock.updateMany({
        where: { productId: { in: alvoIds }, ...(siteId ? { siteId } : {}) },
        data: { locationId: d.locationId },
      });
    }

    // ── Reprecificação ──
    // SQL cru porque o novo preço depende do atual (o Prisma só sabe gravar
    // valor pronto). Preço fixo não exige preço anterior; % e soma, sim.
    if (d.preco && comPrecoIds.length) {
      const fator =
        d.preco.modo === "percentual" ? 1 + d.preco.valor / 100 : d.preco.valor;
      const sql = `
        UPDATE "Product"
           SET "precoVenda" = GREATEST(${expressaoPreco(d.preco)}, 0)
         WHERE "tenantId" = $2
           AND id IN (SELECT jsonb_array_elements_text($3::jsonb))
           ${d.preco.modo === "fixo" ? "" : `AND "precoVenda" IS NOT NULL`}
      `;
      await comTenant(
        tid,
        basePrisma.$executeRawUnsafe(sql, fator, tid, JSON.stringify(comPrecoIds)),
      );
    }

    // ── Etiquetas ──
    if (d.etiquetas) {
      const nomes = [...new Set(d.etiquetas.nomes.map((n) => n.trim()).filter(Boolean))];
      const tagIds: string[] = [];
      for (const nome of nomes) {
        let tag = await db.tag.findFirst({ where: { nome }, select: { id: true } });
        // Etiqueta nova nasce no ato: a alternativa é um cadastro à parte para
        // digitar uma palavra.
        if (!tag && d.etiquetas.modo !== "remover") {
          tag = await db.tag.create({ data: { tenantId: tid, nome }, select: { id: true } });
          invalidarOpcoesFiltro(tid);
        }
        if (tag) tagIds.push(tag.id);
      }

      if (d.etiquetas.modo === "substituir") {
        await db.productTag.deleteMany({ where: { productId: { in: alvoIds } } });
      } else if (d.etiquetas.modo === "remover" && tagIds.length) {
        await db.productTag.deleteMany({
          where: { productId: { in: alvoIds }, tagId: { in: tagIds } },
        });
      }

      if (d.etiquetas.modo !== "remover" && tagIds.length) {
        await db.productTag.createMany({
          data: alvoIds.flatMap((productId) =>
            tagIds.map((tagId) => ({ tenantId: tid, productId, tagId })),
          ),
          skipDuplicates: true,
        });
      }
    }

    // ── Fornecedores ──
    if (d.fornecedores) {
      const { modo } = d.fornecedores;
      const pedidos = [...new Set(d.fornecedores.ids)].filter(Boolean);
      const validos = pedidos.length
        ? await db.supplier.findMany({
            where: { id: { in: pedidos } },
            select: { id: true },
          })
        : [];
      const validSet = new Set(validos.map((s) => s.id));
      // Ordem preservada: o primeiro da lista é quem vira principal.
      const lista = pedidos.filter((id) => validSet.has(id));
      if (pedidos.length && !lista.length) throw new Error("Fornecedor inválido.");

      if (modo === "substituir") {
        // Custo negociado é dado do operador, não do vínculo: quem continua na
        // lista leva o custo junto em vez de voltar a zero.
        const antes = await db.productSupplier.findMany({
          where: { productId: { in: alvoIds } },
          select: { productId: true, supplierId: true, custoFornecedor: true, codigoNoFornecedor: true },
        });
        const memoria = new Map(
          antes.map((a) => [`${a.productId}:${a.supplierId}`, a]),
        );
        await db.productSupplier.deleteMany({ where: { productId: { in: alvoIds } } });
        if (lista.length) {
          await db.productSupplier.createMany({
            data: alvoIds.flatMap((productId) =>
              lista.map((supplierId, i) => {
                const antigo = memoria.get(`${productId}:${supplierId}`);
                return {
                  tenantId: tid,
                  productId,
                  supplierId,
                  custoFornecedor: antigo?.custoFornecedor ?? null,
                  codigoNoFornecedor: antigo?.codigoNoFornecedor ?? null,
                  isPrincipal: i === 0,
                };
              }),
            ),
          });
        }
      } else if (modo === "adicionar" && lista.length) {
        const atuais = await db.productSupplier.findMany({
          where: { productId: { in: alvoIds } },
          select: { productId: true, supplierId: true, isPrincipal: true },
        });
        const porProduto = new Map<string, { sids: Set<string>; temPrincipal: boolean }>();
        for (const pid of alvoIds) porProduto.set(pid, { sids: new Set(), temPrincipal: false });
        for (const a of atuais) {
          const e = porProduto.get(a.productId);
          if (!e) continue;
          e.sids.add(a.supplierId);
          if (a.isPrincipal) e.temPrincipal = true;
        }
        const novos = alvoIds.flatMap((productId) => {
          const e = porProduto.get(productId)!;
          return lista
            .filter((supplierId) => !e.sids.has(supplierId))
            .map((supplierId) => {
              // Produto que ainda não tinha ninguém ganha o primeiro como principal.
              const isPrincipal = !e.temPrincipal;
              e.temPrincipal = true;
              return { tenantId: tid, productId, supplierId, isPrincipal };
            });
        });
        if (novos.length) await db.productSupplier.createMany({ data: novos });
      } else if (modo === "remover" && lista.length) {
        await db.productSupplier.deleteMany({
          where: { productId: { in: alvoIds }, supplierId: { in: lista } },
        });
        // Produto que perdeu o principal fica com uma lista sem dono — elege o
        // primeiro que sobrou, senão nenhuma tela sabe qual custo usar.
        const restantes = await db.productSupplier.findMany({
          where: { productId: { in: alvoIds } },
          select: { id: true, productId: true, isPrincipal: true },
        });
        const orfaos = new Map<string, string>();
        const comDono = new Set<string>();
        for (const r of restantes) {
          if (r.isPrincipal) comDono.add(r.productId);
          else if (!orfaos.has(r.productId)) orfaos.set(r.productId, r.id);
        }
        const promover = [...orfaos.entries()]
          .filter(([pid]) => !comDono.has(pid))
          .map(([, linkId]) => linkId);
        if (promover.length) {
          await db.productSupplier.updateMany({
            where: { id: { in: promover } },
            data: { isPrincipal: true },
          });
        }
      }
    }

    ok();
    revalidatePath("/fornecedores", "layout");
    return { alterados: alvoIds.length, desfazer };
  });
}

/**
 * Volta um lote ao estado anterior (botão "Desfazer" do toast). Só campos
 * escalares: é exatamente o que o snapshot guardou.
 */
export async function desfazerBulkEdit(snapshot: BulkSnapshotItem[]): Promise<number> {
  return tx(async () => {
    if (!snapshot.length || snapshot.length > TETO_DESFAZER) return 0;

    // Agrupa por valor anterior idêntico: cadastro costuma ter muita coluna
    // igual (null, false), então isso transforma N updates em poucos.
    const grupos = new Map<string, { data: Record<string, unknown>; ids: string[] }>();
    for (const item of snapshot) {
      const { id, ...campos } = item;
      const chave = JSON.stringify(campos);
      const g = grupos.get(chave);
      if (g) g.ids.push(id);
      else grupos.set(chave, { data: campos as Record<string, unknown>, ids: [id] });
    }

    for (const g of grupos.values()) {
      if (!Object.keys(g.data).length) continue;
      await db.product.updateMany({ where: { id: { in: g.ids } }, data: g.data });
    }

    ok();
    return snapshot.length;
  });
}

async function attachTags(tid: string, productId: string, tags: string[]) {
  for (const raw of tags) {
    const nome = raw.trim();
    if (!nome) continue;
    let tag = await db.tag.findFirst({ where: { nome } });
    if (!tag) {
      tag = await db.tag.create({ data: { tenantId: tid, nome } });
      invalidarOpcoesFiltro(tid);
    }
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

    await assertCabeProduto(tid);
    const product = await db.product.create({
      data: {
        tenantId: tid,
        tipo: "PERSONALIZADO",
        nome: d.nome.trim(),
        ean: d.ean ? onlyDigits(d.ean) : null,
        sku,
        subcategoryId: d.subcategoryId,
        // Receita é preparo da casa, não produto de fabricante: nunca tem marca.
        brandId: null,
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
    await db.product.update({
      where: { id },
      data: {
        nome: d.nome.trim(),
        ean: d.ean ? onlyDigits(d.ean) : null,
        subcategoryId: d.subcategoryId,
        // Receita nunca tem marca — limpa herança de cadastros antigos.
        brandId: null,
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

/**
 * Checagem leve de EAN já cadastrado — usada no on-blur do formulário para
 * avisar cedo, sem disparar o enriquecimento externo.
 */
export async function checkEanTaken(
  eanRaw: string,
): Promise<{ taken: boolean; id?: string; nome?: string; sku?: string }> {
  return tx(async () => {
    const ean = onlyDigits(eanRaw);
    if (ean.length < 8) return { taken: false };
    const existente = await db.product.findFirst({
      where: { ean },
      select: { id: true, nome: true, sku: true },
    });
    return existente
      ? { taken: true, id: existente.id, nome: existente.nome, sku: existente.sku }
      : { taken: false };
  });
}

/**
 * Descrição curta para canal online (iFood, Mercado Livre…), sugerida por IA
 * a partir de nome/marca/categoria. Sem LLM configurado, cai num texto simples
 * — nunca bloqueia o cadastro por falta de chave.
 */
export async function sugerirDescricaoOnline(input: {
  nome: string;
  marcaNome?: string;
  categoriaNome?: string;
}): Promise<string> {
  return tx(async () => {
    const nome = input.nome.trim();
    if (nome.length < 2) throw new Error("Informe o nome do produto primeiro.");
    if (!llmConfigured()) {
      return [nome, input.marcaNome, input.categoriaNome].filter(Boolean).join(" — ");
    }
    const texto = await completeJson<{ descricao: string }>({
      system:
        "Você escreve descrições curtas de produto para canais de venda online " +
        "(iFood, Mercado Livre) de um mercado/conveniência. Responda SOMENTE com " +
        "JSON válido, sem texto extra.",
      user: JSON.stringify({
        instrucao:
          "Escreva uma descrição de até 200 caracteres, direta, sem emojis, " +
          "destacando o que o produto é — devolva em { descricao }.",
        produto: {
          nome,
          marca: input.marcaNome || undefined,
          categoria: input.categoriaNome || undefined,
        },
      }),
    });
    return texto.descricao.trim();
  });
}

/**
 * Preço sugerido para a subcategoria: mediana da margem praticada nos produtos
 * ativos que já têm custo e preço. Serve de referência real do tenant — nada de
 * markup mágico. Retorna null quando não há histórico suficiente.
 */
export async function sugerirMargemSubcategoria(
  subcategoryId: string,
): Promise<{ margemPct: number; base: number } | null> {
  return tx(async () => {
    if (!subcategoryId) return null;
    const produtos = await db.product.findMany({
      where: {
        subcategoryId,
        ativo: true,
        tipo: "SIMPLES",
        custo: { gt: 0 },
        precoVenda: { gt: 0 },
      },
      select: { custo: true, precoVenda: true },
      take: 200,
    });
    const margens = produtos
      .map((p) => {
        const custo = Number(p.custo);
        const preco = Number(p.precoVenda);
        return preco > 0 ? ((preco - custo) / preco) * 100 : null;
      })
      .filter((m): m is number => m !== null && Number.isFinite(m))
      .sort((a, b) => a - b);
    if (margens.length < 3) return null;
    const meio = Math.floor(margens.length / 2);
    const mediana =
      margens.length % 2 === 0
        ? (margens[meio - 1] + margens[meio]) / 2
        : margens[meio];
    return { margemPct: Math.round(mediana), base: margens.length };
  });
}

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
      // Qualquer outra falha (rede, parse, inesperada) — degrada em vez de 500.
      return {
        encontrado: false,
        fonte: "nenhuma",
        motivo: "erro",
        erro: "Não foi possível consultar agora. Preencha à mão.",
      };
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
