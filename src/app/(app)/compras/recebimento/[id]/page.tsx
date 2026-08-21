import { redirect } from "next/navigation";

// Este redirect preserva links e favoritos antigos; o código vive em
// `pedidos/recebimento/[id]/`.

export default async function RecebimentoDetalheRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/pedidos/recebimento/${id}`);
}
