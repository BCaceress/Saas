import { requirePermissao } from "@/lib/guard";

/** Guard do módulo: sem a permissão, nem a URL direta abre a tela. */
export default async function FornecedoresLayout({ children }: { children: React.ReactNode }) {
  await requirePermissao("fornecedor.ver");
  return <>{children}</>;
}
