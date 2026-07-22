import { requirePermissao } from "@/lib/guard";

/** Guard do módulo: sem a permissão, nem a URL direta abre a tela. */
export default async function ProdutosLayout({ children }: { children: React.ReactNode }) {
  await requirePermissao("produto.editar");
  return <>{children}</>;
}
