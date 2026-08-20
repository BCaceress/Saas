import { redirect } from "next/navigation";

// Este redirect preserva links e favoritos antigos; o código vive em
// `cotacoes/[id]/`.

export default async function CompraRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/cotacoes/${id}`);
}
