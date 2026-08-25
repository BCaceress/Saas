import { redirect } from "next/navigation";

// A conferência saiu de dentro de Pedidos: a nota não é assunto só de compras
// (o contador trata o XML da mesma nota), então a rota canônica é /recebimento.
// Este redirect é o que mantém de pé o que já saiu daqui e não dá para
// reeditar: o QR impresso no pedido, o link no e-mail e o favorito do operador.

export default async function RecebimentoDetalheRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/recebimento/${id}`);
}
