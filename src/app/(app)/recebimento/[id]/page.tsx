import { redirect } from "next/navigation";

// A conferência mudou de casa para dentro de Pedidos. Este redirect é o que
// mantém de pé o que já saiu daqui e não dá para reeditar: o QR de recebimento
// impresso no pedido, o link no e-mail da nota e o favorito do operador.

export default async function RecebimentoDetalheRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/pedidos/recebimento/${id}`);
}
