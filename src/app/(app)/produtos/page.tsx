import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { PRODUCT_INCLUDE, toProductRow } from "./_data";
import { ProdutosClient } from "./_client";
import type { ProductRow, BrandOpt, SubcategoryFilterOpt } from "./_types";

export const metadata = { title: "Produtos — NoHub Market" };

export default async function ProdutosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const ctx = await requireActiveTenant();
  const sp = await searchParams;

  const data = await runWithTenant(ctx.tenant.id, async () => {
    const [products, categories, brands] = await Promise.all([
      db.product.findMany({
        orderBy: { nome: "asc" },
        include: PRODUCT_INCLUDE,
      }),
      // Só o necessário pro filtro de subcategoria — árvore completa (com
      // inativas/skuPrefix) fica no fetch sob demanda de "Gerenciar".
      db.category.findMany({
        orderBy: { nome: "asc" },
        select: {
          nome: true,
          subcategories: {
            where: { ativo: true },
            orderBy: { nome: "asc" },
            select: { id: true, nome: true },
          },
        },
      }),
      db.brand.findMany({ orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
    ]);

    const rows: ProductRow[] = products.map((p) => toProductRow(p));

    const subOpts: SubcategoryFilterOpt[] = categories.flatMap((c) =>
      c.subcategories.map((s) => ({ id: s.id, nome: s.nome, categoriaNome: c.nome }))
    );

    const brandOpts: BrandOpt[] = brands;

    return { rows, subOpts, brandOpts };
  });

  return (
    <ProdutosClient
      {...data}
      initialFornecedorId={sp.fornecedorId}
      initialFornecedorNome={sp.fornecedorNome}
    />
  );
}
