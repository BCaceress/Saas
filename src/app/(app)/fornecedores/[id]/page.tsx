import { notFound } from "next/navigation";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { loadFornecedorCadastro } from "./_data";
import { ResumoFornecedor } from "./_resumo";

export default async function FornecedorResumoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireActiveTenant();
  const { id } = await params;

  const fornecedor = await withTenant(ctx, () => loadFornecedorCadastro(id));
  if (!fornecedor) notFound();

  return (
    <ResumoFornecedor
      fornecedor={fornecedor}
      podeEditar={podeEmAlguma(ctx.acessos, "fornecedor.editar")}
    />
  );
}
