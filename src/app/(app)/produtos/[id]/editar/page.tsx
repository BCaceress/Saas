import { notFound } from "next/navigation";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { ProductForm } from "../../_form/product-form";
import { ComboForm } from "../../_form/combo-form";
import { ReceitaForm } from "../../_form/receita-form";
import { loadProductFormOptions, loadComponentCandidates } from "../../_data";
import type { ProductRow, ComboData, ReceitaData, RecipeType, SelectionType } from "../../_types";

export const metadata = { title: "Editar produto — NoHub Market" };

const dec = (v: { toNumber: () => number } | null | undefined) =>
  v == null ? null : v.toNumber();

export default async function EditarProdutoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireActiveTenant();

  const data = await runWithTenant(ctx.tenant.id, async () => {
    const p = await db.product.findFirst({
      where: { id },
      include: {
        brand: true,
        subcategory: { include: { category: true } },
        stocks: true,
        components: { where: { groupId: null } },
        componentGroups: {
          orderBy: { ordem: "asc" },
          include: { components: true },
        },
        variants: { orderBy: { fatorEscala: "asc" } },
        salesChannels: true,
        suppliers: { include: { supplier: true } },
        packagings: { orderBy: { isCompraDefault: "desc" } },
      },
    });
    if (!p) return null;
    const opts = await loadProductFormOptions();

    const salesChannels = p.salesChannels.map((sc) => ({
      canal: sc.canal,
      ativo: sc.ativo,
      precoCanal: dec(sc.precoCanal),
      descricaoCanal: sc.descricaoCanal,
    }));

    // COMBO — form próprio.
    if (p.tipo === "COMBO") {
      const candidates = await loadComponentCandidates();
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
        salesChannels,
      };
      return { kind: "combo" as const, combo, opts, candidates };
    }

    // PERSONALIZADO/RECEITA — form próprio (ficha técnica + split DRINK/PRATO).
    if (p.tipo === "PERSONALIZADO") {
      const candidates = await loadComponentCandidates();
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
        salesChannels,
      };
      return { kind: "receita" as const, receita, opts, candidates };
    }

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
      precoVenda: dec(p.precoVenda),
      custo: dec(p.custo),
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
      disponibilidadeDerivada: null,
      salesChannels,
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
      locais: [],
    };
    return { kind: "product" as const, row, opts };
  });

  if (!data) notFound();

  if (data.kind === "combo") {
    return (
      <ComboForm
        mode="edit"
        combo={data.combo}
        candidates={data.candidates}
      />
    );
  }

  if (data.kind === "receita") {
    return (
      <ReceitaForm
        mode="edit"
        receita={data.receita}
        subcategories={data.opts.subOpts}
        candidates={data.candidates}
      />
    );
  }

  return (
    <ProductForm
      mode="edit"
      tipo={data.row.tipo === "INSUMO" ? "INSUMO" : "SIMPLES"}
      product={data.row}
      brands={data.opts.brandOpts}
      categories={data.opts.categoryOpts}
      subcategories={data.opts.subOpts}
      storage={data.opts.storageOpts}
      suppliers={data.opts.supplierRows}
      fiscalProfiles={data.opts.fiscalOpts}
    />
  );
}
