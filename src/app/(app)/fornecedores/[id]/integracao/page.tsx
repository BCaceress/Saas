import { notFound } from "next/navigation";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { loadFornecedorHeader, loadIntegracao } from "../_data";
import { IntegracaoCliente } from "./_client";

export default async function IntegracaoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireActiveTenant();
  const { id } = await params;

  const dados = await withTenant(ctx, async () => {
    const [integracao, header] = await Promise.all([loadIntegracao(id), loadFornecedorHeader(id)]);
    return { integracao, header };
  });
  if (!dados.integracao || !dados.header) notFound();

  return (
    <IntegracaoCliente
      integracao={dados.integracao}
      nome={dados.header.nome}
      podeEditar={podeEmAlguma(ctx.acessos, "fornecedor.editar")}
    />
  );
}
