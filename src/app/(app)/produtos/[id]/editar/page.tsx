import { notFound } from "next/navigation";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { FormProduto } from "../../_form/despachante";
import { loadProductFormOptions, loadComponentCandidates } from "../../_data";
import type { ProductRow, ComboData, ReceitaData, RecipeType, SelectionType } from "../../_types";

export const metadata = { title: "Editar produto — NoHub Market" };

const dec = (v: { toNumber: () => number } | null | undefined) =>
  v == null ? null : v.toNumber();

/**
 * Colunas comuns aos três formulários. Sempre `select`, nunca `include: true`:
 * `include` traz a tabela inteira de cada relação (Supplier tem endereço, IE,
 * logo…) e isso atravessa o payload RSC até o browser sem ninguém ler.
 */
const CAMPOS_BASE = {
  id: true,
  tipo: true,
  nome: true,
  sku: true,
  ean: true,
  imagemUrl: true,
  brandId: true,
  subcategoryId: true,
  precoVenda: true,
  ativo: true,
  restricaoIdade: true,
  fiscalProfileId: true,
  vendeOnline: true,
  pesoGramas: true,
  descricaoOnline: true,
  brand: { select: { nome: true } },
  salesChannels: {
    select: { canal: true, ativo: true, precoCanal: true, descricaoCanal: true },
  },
} as const;

export default async function EditarProdutoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireActiveTenant();

  const data = await runWithTenant(ctx.tenant.id, async () => {
    // Sonda de tipo antes da consulta cheia.
    //
    // Os três formulários leem coisas diferentes: SIMPLES/INSUMO quer estoque,
    // embalagens e fornecedores; COMBO/RECEITA quer itens, grupos e variações.
    // Uma consulta só com tudo dentro fazia todo produto simples — o caso
    // comum — pagar quatro consultas de relação que ninguém abriria. Uma ida
    // extra ao banco por chave primária custa milissegundos; buscar o catálogo
    // de itens de um produto que não é composto custa muito mais.
    //
    // Roda em paralelo com as opções do formulário, que vêm de cache (_data.ts)
    // e no caso quente nem tocam o banco.
    const [tipoRow, opts] = await Promise.all([
      db.product.findFirst({ where: { id }, select: { tipo: true } }),
      loadProductFormOptions(ctx.tenant.id),
    ]);
    if (!tipoRow) return null;

    // ── COMBO — form próprio ──
    if (tipoRow.tipo === "COMBO") {
      const [p, candidates] = await Promise.all([
        db.product.findFirst({
          where: { id },
          select: {
            ...CAMPOS_BASE,
            components: {
              where: { groupId: null },
              select: { componentProductId: true, quantidade: true },
            },
          },
        }),
        loadComponentCandidates(),
      ]);
      if (!p) return null;

      const combo: ComboData = {
        id: p.id,
        nome: p.nome,
        sku: p.sku,
        marca: p.brand?.nome ?? null,
        brandId: p.brandId,
        subcategoryId: p.subcategoryId,
        imagemUrl: p.imagemUrl,
        precoVenda: dec(p.precoVenda),
        fiscalProfileId: p.fiscalProfileId,
        restricaoIdade: p.restricaoIdade,
        ativo: p.ativo,
        vendeOnline: p.vendeOnline,
        pesoGramas: p.pesoGramas,
        descricaoOnline: p.descricaoOnline,
        components: p.components.map((c) => ({
          componentProductId: c.componentProductId,
          quantidade: dec(c.quantidade) ?? 1,
        })),
        salesChannels: canais(p.salesChannels),
      };
      return { kind: "combo" as const, combo, opts, candidates };
    }

    // ── PERSONALIZADO/RECEITA — ficha técnica + split DRINK/PRATO ──
    if (tipoRow.tipo === "PERSONALIZADO") {
      const [p, candidates] = await Promise.all([
        db.product.findFirst({
          where: { id },
          select: {
            ...CAMPOS_BASE,
            tipoReceita: true,
            copoMl: true,
            modoPreparo: true,
            components: {
              where: { groupId: null },
              select: { componentProductId: true, quantidade: true, unidade: true },
            },
            componentGroups: {
              orderBy: { ordem: "asc" },
              select: {
                id: true,
                nome: true,
                obrigatoria: true,
                tipoSelecao: true,
                maxSelecoes: true,
                ordem: true,
                components: {
                  select: {
                    componentProductId: true,
                    quantidade: true,
                    unidade: true,
                    isDefault: true,
                    acrescenta: true,
                    acrescimoPreco: true,
                  },
                },
              },
            },
            variants: {
              orderBy: { fatorEscala: "asc" },
              select: {
                id: true,
                nome: true,
                volumeMl: true,
                fatorEscala: true,
                precoVenda: true,
                isDefault: true,
              },
            },
          },
        }),
        loadComponentCandidates(),
      ]);
      if (!p) return null;

      const inferredType = p.tipoReceita ?? (p.variants.length > 0 ? "DRINK" : "OUTRO");
      const receita: ReceitaData = {
        id: p.id,
        nome: p.nome,
        sku: p.sku,
        ean: p.ean,
        marca: p.brand?.nome ?? null,
        brandId: p.brandId,
        subcategoryId: p.subcategoryId ?? "",
        imagemUrl: p.imagemUrl,
        precoVenda: dec(p.precoVenda),
        fiscalProfileId: p.fiscalProfileId,
        restricaoIdade: p.restricaoIdade,
        ativo: p.ativo,
        tipoReceita: inferredType as RecipeType,
        copoMl: dec(p.copoMl),
        modoPreparo: p.modoPreparo,
        vendeOnline: p.vendeOnline,
        pesoGramas: p.pesoGramas,
        descricaoOnline: p.descricaoOnline,
        components: p.components.map((c) => ({
          componentProductId: c.componentProductId,
          quantidade: dec(c.quantidade) ?? 0,
          unidade: c.unidade,
        })),
        groups: p.componentGroups.map((g) => ({
          id: g.id,
          nome: g.nome,
          obrigatoria: g.obrigatoria,
          tipoSelecao: g.tipoSelecao as SelectionType,
          maxSelecoes: g.maxSelecoes,
          ordem: g.ordem,
          items: g.components.map((c) => ({
            componentProductId: c.componentProductId,
            quantidade: dec(c.quantidade) ?? 0,
            unidade: c.unidade,
            isDefault: c.isDefault,
            acrescenta: c.acrescenta,
            acrescimoPreco: dec(c.acrescimoPreco),
          })),
        })),
        variants: p.variants.map((v) => ({
          id: v.id,
          nome: v.nome,
          volumeMl: dec(v.volumeMl),
          fatorEscala: dec(v.fatorEscala) ?? 1,
          precoVenda: dec(v.precoVenda),
          isDefault: v.isDefault,
        })),
        salesChannels: canais(p.salesChannels),
      };
      return { kind: "receita" as const, receita, opts, candidates };
    }

    // ── SIMPLES/INSUMO — o caso comum ──
    const p = await db.product.findFirst({
      where: { id },
      select: {
        ...CAMPOS_BASE,
        custo: true,
        unidadeBase: true,
        vendaUnidade: true,
        fracionavel: true,
        conteudoPorUnidade: true,
        dosePadrao: true,
        alturaCm: true,
        larguraCm: true,
        comprimentoCm: true,
        gtinTributavel: true,
        unidadeTributavel: true,
        fatorConversaoTrib: true,
        codigoAnp: true,
        controlaEstoque: true,
        variacaoLabel: true,
        subcategory: {
          select: { nome: true, categoryId: true, category: { select: { nome: true } } },
        },
        stocks: {
          select: {
            estoqueFechado: true,
            estoqueAberto: true,
            estoqueMinimo: true,
            estoqueIdeal: true,
            locationId: true,
          },
        },
        suppliers: {
          select: {
            supplierId: true,
            isPrincipal: true,
            custoFornecedor: true,
            supplier: { select: { razaoSocial: true, nomeFantasia: true } },
          },
        },
        packagings: {
          orderBy: { isCompraDefault: "desc" },
          select: { id: true, nome: true, ean: true, fatorConversao: true },
        },
        purchaseVariants: {
          where: { ativo: true },
          orderBy: [{ ordem: "asc" }, { nome: "asc" }],
          select: { id: true, nome: true, ean: true },
        },
      },
    });
    if (!p) return null;

    const principal = p.suppliers.find((s) => s.isPrincipal) ?? p.suppliers[0];
    const row: ProductRow = {
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
      categoryId: p.subcategory?.categoryId ?? "",
      precoVenda: dec(p.precoVenda),
      custo: dec(p.custo),
      ativo: p.ativo,
      restricaoIdade: p.restricaoIdade,
      unidadeBase: p.unidadeBase,
      vendaUnidade: p.vendaUnidade,
      fracionavel: p.fracionavel,
      conteudoPorUnidade: dec(p.conteudoPorUnidade),
      dosePadrao: dec(p.dosePadrao),
      vendeOnline: p.vendeOnline,
      pesoGramas: p.pesoGramas,
      alturaCm: dec(p.alturaCm),
      larguraCm: dec(p.larguraCm),
      comprimentoCm: dec(p.comprimentoCm),
      descricaoOnline: p.descricaoOnline,
      fiscalProfileId: p.fiscalProfileId,
      gtinTributavel: p.gtinTributavel,
      unidadeTributavel: p.unidadeTributavel,
      fatorConversaoTrib: dec(p.fatorConversaoTrib),
      codigoAnp: p.codigoAnp,
      estoque: {
        fechado: p.stocks.reduce((s, st) => s + Number(st.estoqueFechado), 0),
        aberto: p.stocks.reduce((s, st) => s + Number(st.estoqueAberto), 0),
        minimo: dec(p.stocks[0]?.estoqueMinimo) ?? 0,
        ideal: dec(p.stocks[0]?.estoqueIdeal) ?? 0,
        locationId: p.stocks[0]?.locationId ?? null,
        controlado: p.controlaEstoque,
      },
      fornecedorPrincipalId: principal?.supplierId ?? null,
      custoFornecedor: dec(principal?.custoFornecedor),
      disponibilidadeDerivada: null,
      salesChannels: canais(p.salesChannels),
      packagings: p.packagings.map((pk) => ({
        id: pk.id,
        nome: pk.nome,
        ean: pk.ean,
        fatorConversao: dec(pk.fatorConversao) ?? 1,
      })),
      variacaoLabel: p.variacaoLabel,
      variacoes: p.purchaseVariants.map((v) => ({ id: v.id, nome: v.nome, ean: v.ean })),
      fornecedores: p.suppliers.map((ps) => ({
        id: ps.supplierId,
        nome: ps.supplier.nomeFantasia ?? ps.supplier.razaoSocial,
        isPrincipal: ps.isPrincipal,
      })),
      locais: [],
    };
    return { kind: "product" as const, row, opts };
  });

  if (!data) notFound();

  if (data.kind === "combo") {
    return (
      <FormProduto
        kind="combo"
        mode="edit"
        combo={data.combo}
        candidates={data.candidates}
      />
    );
  }

  if (data.kind === "receita") {
    return (
      <FormProduto
        kind="receita"
        mode="edit"
        receita={data.receita}
        subcategories={data.opts.subOpts}
        candidates={data.candidates}
      />
    );
  }

  return (
    <FormProduto
      kind="product"
      mode="edit"
      tipo={data.row.tipo === "INSUMO" ? "INSUMO" : "SIMPLES"}
      product={data.row}
      brands={data.opts.brandOpts}
      categories={data.opts.categoryOpts}
      subcategories={data.opts.subOpts}
      storage={data.opts.storageOpts}
      suppliers={data.opts.supplierRows}
      fiscalProfiles={data.opts.fiscalOpts}
      policy={policyDoTenant(ctx.tenant)}
    />
  );
}

type CanalRow = {
  canal: ProductRow["salesChannels"][number]["canal"];
  ativo: boolean;
  precoCanal: { toNumber: () => number } | null;
  descricaoCanal: string | null;
};

const canais = (rows: CanalRow[]): ProductRow["salesChannels"] =>
  rows.map((sc) => ({
    canal: sc.canal,
    ativo: sc.ativo,
    precoCanal: dec(sc.precoCanal),
    descricaoCanal: sc.descricaoCanal,
  }));
