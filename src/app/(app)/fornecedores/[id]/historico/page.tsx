import { notFound } from "next/navigation";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { loadHistoricoFornecedor } from "@/lib/fornecedores/historico";
import { HistoricoFornecedorClient } from "./_client";

export default async function HistoricoFornecedorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireActiveTenant();
  const { id } = await params;

  const historico = await withTenant(ctx, () => loadHistoricoFornecedor(id));
  if (!historico) notFound();

  return (
    <HistoricoFornecedorClient
      historico={historico}
      podeEditar={podeEmAlguma(ctx.acessos, "fornecedor.editar")}
    />
  );
}
