import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { loadFornecedores } from "./_data";
import { FornecedoresManager } from "./_client";

export default async function FornecedoresPage() {
  const ctx = await requireActiveTenant();
  const suppliers = await withTenant(ctx, () => loadFornecedores());

  return (
    <div className="flex flex-col gap-5">
      <FornecedoresManager
        suppliers={suppliers}
        podeEditar={podeEmAlguma(ctx.acessos, "fornecedor.editar")}
      />
    </div>
  );
}
