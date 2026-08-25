import { redirect } from "next/navigation";

// Este redirect preserva links e favoritos antigos; a rota canônica da
// conferência é `/recebimento/[id]`.

export default async function RecebimentoDetalheRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/recebimento/${id}`);
}
