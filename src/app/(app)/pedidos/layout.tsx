import { requirePermissao } from "@/lib/guard";

/** Guard do módulo: sem a permissão, nem a URL direta abre a tela. */
export default async function PedidosLayout({ children }: { children: React.ReactNode }) {
  await requirePermissao("compras.ver");
  return <div className="flex flex-col gap-5">{children}</div>;
}
