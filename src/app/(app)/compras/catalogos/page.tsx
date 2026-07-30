import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { loadDashboard } from "../_catalogo/data";
import { ListaCatalogos } from "./_client";

export default async function CatalogosPage() {
  const ctx = await requireActiveTenant();
  const { fornecedores } = await withTenant(ctx, () => loadDashboard());

  return <ListaCatalogos fornecedores={fornecedores} />;
}
