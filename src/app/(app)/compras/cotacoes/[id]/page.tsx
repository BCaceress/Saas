import { notFound } from "next/navigation";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { loadCotacao, loadOpcoes } from "../_data";
import { CotacaoDetalheClient } from "./_client";

export default async function CotacaoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireActiveTenant();

  const dados = await withTenant(ctx, async () => {
    const cotacao = await loadCotacao(id);
    if (!cotacao) return null;
    const opcoes = await loadOpcoes();
    return { cotacao, opcoes };
  });

  if (!dados) notFound();

  return (
    <CotacaoDetalheClient
      cotacao={dados.cotacao}
      produtos={dados.opcoes.produtos}
      fornecedores={dados.opcoes.fornecedores}
      podePedir={podeEmAlguma(ctx.acessos, "compras.pedir")}
    />
  );
}
