import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { PRODUCT_INCLUDE, toProductRow } from "./_data";
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

export default async function ProdutosPage() {
  const ctx = await requireActiveTenant();

  const data = await runWithTenant(ctx.tenant.id, async () => {
    const [products, categories, brands, locations, suppliers, sites, salesStats] =
      await Promise.all([
        db.product.findMany({
          orderBy: { nome: "asc" },
          include: PRODUCT_INCLUDE,
        }),
        db.category.findMany({
          orderBy: { nome: "asc" },
          include: { subcategories: { orderBy: { nome: "asc" } } },
        }),
        db.brand.findMany({ orderBy: { nome: "asc" } }),
        db.storageLocation.findMany({
          where: { ativo: true },
          orderBy: { nome: "asc" },
          include: { site: { select: { nome: true } } },
        }),
        db.supplier.findMany({ orderBy: { razaoSocial: "asc" } }),
        db.site.findMany({
          where: { ativo: true },
          orderBy: { nome: "asc" },
          select: { id: true, nome: true },
        }),
        db.saleItem.groupBy({ by: ["productId"], _sum: { quantidade: true } }),
      ]);
    const vendidoMap = Object.fromEntries(
      salesStats.map((s) => [s.productId, Number(s._sum.quantidade ?? 0)])
    );

    const rows: ProductRow[] = products.map((p) => toProductRow(p, vendidoMap[p.id] ?? 0));

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
      ativo: l.ativo,
      siteId: l.siteId,
      siteNome: l.site?.nome ?? null,
    }));
    const siteOpts = sites.map((s) => ({ id: s.id, nome: s.nome }));
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
    return { rows, categoryTree, subOpts, brandOpts, storageOpts, supplierRows, siteOpts };
  });

  return <ProdutosClient {...data} />;
}
