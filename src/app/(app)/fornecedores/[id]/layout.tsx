import { notFound } from "next/navigation";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { podeEmAlguma } from "@/lib/permissoes";
import { loadFornecedorHeader } from "./_data";
import { FornecedorShell } from "./_shell";

// O guard do módulo (`fornecedor.ver`) mora em fornecedores/layout.tsx — toda
// aba herda. Aqui só se resolve QUAL fornecedor está aberto.

export default async function FornecedorLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireActiveTenant();
  const { id } = await params;

  const header = await withTenant(ctx, () => loadFornecedorHeader(id));
  if (!header) notFound();

  return (
    <FornecedorShell header={header} podeEditar={podeEmAlguma(ctx.acessos, "fornecedor.editar")}>
      {children}
    </FornecedorShell>
  );
}
