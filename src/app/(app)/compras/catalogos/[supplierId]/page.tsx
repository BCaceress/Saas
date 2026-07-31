import { redirect } from "next/navigation";

// O catálogo agora é uma aba do fornecedor.

export default async function CatalogoRedirect({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}) {
  const { supplierId } = await params;
  redirect(`/fornecedores/${supplierId}/catalogo`);
}
