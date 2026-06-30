import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { loadSaldos, loadEntradaFormOptions } from "../_data";
import { Layers } from "lucide-react";
import { SaldosView } from "./_client";

export default async function SaldosPage() {
  const ctx = await requireActiveTenant();
  const [siteId, saldos, formOptions] = await withTenant(ctx, async () => {
    const sid = await getActiveSiteId();
    const [s, opts] = await Promise.all([loadSaldos(sid), loadEntradaFormOptions()]);
    return [sid, s, opts] as const;
  });

  const formProps = {
    products: formOptions.products.map((p) => ({
      id: p.id,
      nome: p.nome,
      sku: p.sku,
      imagemUrl: p.imagemUrl,
      packagings: p.packagings.map((pk) => ({
        id: pk.id,
        nome: pk.nome,
        fatorConversao: Number(pk.fatorConversao),
        isCompraDefault: pk.isCompraDefault,
      })),
      suppliers: p.suppliers.map((sup) => ({ supplierId: sup.supplierId })),
      brand: p.brand ? { nome: p.brand.nome } : null,
    })),
    suppliers: formOptions.suppliers.map((s) => ({
      id: s.id,
      razaoSocial: s.razaoSocial,
      nomeFantasia: s.nomeFantasia,
    })),
    sites: formOptions.sites.map((s) => ({ id: s.id, nome: s.nome, tipo: s.tipo })),
  };

  if (saldos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface py-16 text-center">
        <Layers size={36} className="text-faint" />
        <p className="text-sm font-medium text-muted">Nenhum produto com estoque neste site.</p>
        <p className="text-xs text-faint">Registre uma entrada para começar a controlar o estoque.</p>
      </div>
    );
  }

  return <SaldosView saldos={saldos} formOptions={formProps} siteId={siteId} />;
}
