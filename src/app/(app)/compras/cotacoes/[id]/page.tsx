import { redirect } from "next/navigation";

// Cotações virou a tela "Compras" (planejamento). Este redirect preserva
// links e favoritos antigos; o código vive em `compras/[id]/`.

export default async function CotacaoRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/cotacoes/${id}`);
}
