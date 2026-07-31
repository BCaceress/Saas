import { notFound } from "next/navigation";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { loadFornecedorHeader, loadPedidosFornecedor } from "../_data";
import { PedidosFornecedor } from "./_client";

export default async function PedidosFornecedorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireActiveTenant();
  const { id } = await params;

  const dados = await withTenant(ctx, async () => {
    const [pedidos, header] = await Promise.all([
      loadPedidosFornecedor(id),
      loadFornecedorHeader(id),
    ]);
    return { pedidos, header };
  });
  if (!dados.header) notFound();

  return <PedidosFornecedor pedidos={dados.pedidos} nome={dados.header.nome} />;
}
