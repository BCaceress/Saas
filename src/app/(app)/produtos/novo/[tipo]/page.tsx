import { notFound } from "next/navigation";
import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { normalizeSkuPrefix } from "@/lib/normalize";
import { ProductForm, type ProductPrefill } from "../../_form/product-form";
import { ComboForm } from "../../_form/combo-form";
import { ReceitaForm } from "../../_form/receita-form";
import { loadProductFormOptions, loadComponentCandidates } from "../../_data";
import { carregarItemParaNovoProdutoAction } from "../../../compras/_catalogo/actions";
import type { SubcategoryOpt } from "../../_types";

export const metadata = { title: "Novo produto — NoHub Market" };

const TIPO_MAP: Record<string, "SIMPLES" | "INSUMO"> = {
  simples: "SIMPLES",
  insumo: "INSUMO",
};

/** Casa o texto livre de categoria (lido do encarte pela IA) contra as
 * subcategorias do tenant — só como sugestão, o operador sempre confirma. */
function sugerirSubcategoria(
  categoria: string | null,
  subOpts: SubcategoryOpt[],
): string | null {
  const key = (categoria ?? "").trim();
  if (!key) return null;
  const keyPrefix = normalizeSkuPrefix(key);
  const porPrefixo = subOpts.find((s) => s.skuPrefix === keyPrefix);
  if (porPrefixo) return porPrefixo.id;
  const keyLower = key.toLowerCase();
  const porNome = subOpts.find(
    (s) => s.nome.toLowerCase() === keyLower || s.nome.toLowerCase().includes(keyLower),
  );
  return porNome?.id ?? null;
}

export default async function NovoProdutoPage({
  params,
  searchParams,
}: {
  params: Promise<{ tipo: string }>;
  searchParams: Promise<{ fromItem?: string }>;
}) {
  const { tipo } = await params;
  const { fromItem } = await searchParams;

  // COMBO/KIT e PERSONALIZADO — forms próprios com itens + resumo derivado.
  if (tipo === "combo" || tipo === "personalizado") {
    const ctx = await requireActiveTenant();
    const { opts, candidates } = await runWithTenant(ctx.tenant.id, async () => {
      const [opts, candidates] = await Promise.all([
        loadProductFormOptions(),
        loadComponentCandidates(),
      ]);
      return { opts, candidates };
    });
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
  const { opts, prefill } = await runWithTenant(ctx.tenant.id, async () => {
    const opts = await loadProductFormOptions();
    if (!fromItem) return { opts, prefill: undefined };

    // Item veio da revisão do catálogo de um fornecedor (encarte/tabela
    // importada) — o operador não achou produto existente pra vincular e
    // decidiu cadastrar um novo. Erro aqui não deve travar a tela de
    // cadastro em branco: cadastro continua funcionando, só sem prefill.
    let prefill: ProductPrefill | undefined;
    try {
      const item = await carregarItemParaNovoProdutoAction(fromItem);
      prefill = {
        itemId: fromItem,
        nome: item.descricao,
        ean: item.ean,
        marca: item.marca,
        custo: item.custo,
        subcategoryIdSugerido: sugerirSubcategoria(item.categoria, opts.subOpts),
        supplierId: item.supplierId,
        supplierNome: item.supplierNome,
      };
    } catch {
      prefill = undefined;
    }
    return { opts, prefill };
  });

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
      policy={policyDoTenant(ctx.tenant)}
      prefill={prefill}
    />
  );
}
