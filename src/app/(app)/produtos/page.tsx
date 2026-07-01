import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { derive, type DeriveComponent } from "@/lib/derive";
import { ProdutosClient } from "./_client";
import type {
  ProductRow,
  CategoryNode,
  BrandOpt,
  SubcategoryOpt,
  StorageOpt,
  SupplierRow,
} from "./_types";

export const metadata = { title: "Produtos — NoHub Market" };

const dec = (v: { toNumber: () => number } | null | undefined) =>
  v == null ? null : v.toNumber();

export default async function ProdutosPage() {
  const ctx = await requireActiveTenant();

  const data = await runWithTenant(ctx.tenant.id, async () => {
    const [products, categories, brands, locations, suppliers, salesStats] =
      await Promise.all([
        db.product.findMany({
          orderBy: { nome: "asc" },
          include: {
            brand: true,
            subcategory: { include: { category: true } },
            stocks: true,
            packagings: { orderBy: { nome: "asc" } },
            suppliers: {
              include: { supplier: { select: { razaoSocial: true, nomeFantasia: true } } },
              orderBy: { isPrincipal: "desc" },
            },
            components: { include: { component: { include: { stocks: true } } } },
          },
        }),
        db.category.findMany({
          orderBy: { nome: "asc" },
          include: { subcategories: { orderBy: { nome: "asc" } } },
        }),
        db.brand.findMany({ orderBy: { nome: "asc" } }),
        db.storageLocation.findMany({ orderBy: { nome: "asc" } }),
        db.supplier.findMany({ orderBy: { razaoSocial: "asc" } }),
        db.saleItem.groupBy({ by: ["productId"], _sum: { quantidade: true } }),
      ]);
    const vendidoMap = Object.fromEntries(
      salesStats.map((s) => [s.productId, Number(s._sum.quantidade ?? 0)])
    );

    const rows: ProductRow[] = products.map((p) => {
      const principal = p.suppliers.find((s) => s.isPrincipal);

      // COMBO/receita não guardam estoque/custo: derivam dos componentes (§6).
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
        totalVendido: vendidoMap[p.id] ?? 0,
      };
    });

    const categoryTree: CategoryNode[] = categories.map((c) => ({
      id: c.id,
      nome: c.nome,
      skuPrefix: c.skuPrefix,
      subcategorias: c.subcategories.map((s) => ({
        id: s.id,
        nome: s.nome,
        skuPrefix: s.skuPrefix,
        ativo: s.ativo,
      })),
    }));

    const subOpts: SubcategoryOpt[] = categories.flatMap((c) =>
      c.subcategories
        .filter((s) => s.ativo)
        .map((s) => ({
        id: s.id,
        nome: s.nome,
        categoriaNome: c.nome,
        skuPrefix: s.skuPrefix,
        categorySkuPrefix: c.skuPrefix,
        defaultStorageType: s.defaultStorageType,
        defaultFiscalProfileId: s.defaultFiscalProfileId,
      }))
    );

    const brandOpts: BrandOpt[] = brands.map((b) => ({ id: b.id, nome: b.nome }));
    const storageOpts: StorageOpt[] = locations.map((l) => ({
      id: l.id,
      nome: l.nome,
      tipo: l.tipo,
    }));
    const supplierRows: SupplierRow[] = suppliers.map((s) => ({
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
    }));
    return { rows, categoryTree, subOpts, brandOpts, storageOpts, supplierRows };
  });

  return <ProdutosClient {...data} />;
}
