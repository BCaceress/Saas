import { notFound } from "next/navigation";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { loadFornecedorCadastro } from "../_data";
import { ObservacoesFornecedor } from "./_client";

export default async function ObservacoesPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireActiveTenant();
  const { id } = await params;

  const fornecedor = await withTenant(ctx, () => loadFornecedorCadastro(id));
  if (!fornecedor) notFound();

  return (
    <ObservacoesFornecedor
      supplierId={fornecedor.id}
      observacoes={fornecedor.observacoes}
      prazoPagamentoDias={fornecedor.prazoPagamentoDias}
      podeEditar={podeEmAlguma(ctx.acessos, "fornecedor.editar")}
    />
  );
}
