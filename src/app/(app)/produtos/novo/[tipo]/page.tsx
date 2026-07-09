import { notFound } from "next/navigation";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { ProductForm } from "../../_form/product-form";
import { ComboForm } from "../../_form/combo-form";
import { ReceitaForm } from "../../_form/receita-form";
import { loadProductFormOptions, loadComponentCandidates } from "../../_data";

export const metadata = { title: "Novo produto — NoHub Market" };

const TIPO_MAP: Record<string, "SIMPLES" | "INSUMO"> = {
  simples: "SIMPLES",
  insumo: "INSUMO",
};

export default async function NovoProdutoPage({
  params,
}: {
  params: Promise<{ tipo: string }>;
}) {
  const { tipo } = await params;

  // COMBO/KIT e PERSONALIZADO — forms próprios com itens + resumo derivado.
  if (tipo === "combo" || tipo === "personalizado") {
    const ctx = await requireActiveTenant();
    const { opts, candidates } = await runWithTenant(
      ctx.tenant.id,
      async () => ({
        opts: await loadProductFormOptions(),
        candidates: await loadComponentCandidates(),
      }),
    );
    return tipo === "combo" ? (
      <ComboForm mode="new" candidates={candidates} />
    ) : (
      <ReceitaForm
        mode="new"
        subcategories={opts.subOpts}
        candidates={candidates}
      />
    );
  }

  const mapped = TIPO_MAP[tipo];
  if (!mapped) notFound();

  const ctx = await requireActiveTenant();
  const opts = await runWithTenant(ctx.tenant.id, () =>
    loadProductFormOptions(),
  );

  return (
    <ProductForm
      mode="new"
      tipo={mapped}
      brands={opts.brandOpts}
      categories={opts.categoryOpts}
      subcategories={opts.subOpts}
      storage={opts.storageOpts}
      suppliers={opts.supplierRows}
      fiscalProfiles={opts.fiscalOpts}
      defaultEstoqueMinimo={ctx.tenant.estoqueMinimoPadrao}
    />
  );
}
