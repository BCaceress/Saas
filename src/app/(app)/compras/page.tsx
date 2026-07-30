import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { loadDashboard } from "./_catalogo/data";
import { PainelFornecedores } from "./_catalogo/painel";

export default async function ComprasFornecedoresPage() {
  const ctx = await requireActiveTenant();
  const { resumo, fornecedores } = await withTenant(ctx, () => loadDashboard());

  return (
    <PainelFornecedores
      resumo={resumo}
      fornecedores={fornecedores}
      podeEditar={podeEmAlguma(ctx.acessos, "fornecedor.editar")}
    />
  );
}
