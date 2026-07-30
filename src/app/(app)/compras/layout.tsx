import { requirePermissao } from "@/lib/guard";
import { ComprasHeader } from "./_header";

/** Guard do módulo: sem a permissão, nem a URL direta abre a tela. */
export default async function ComprasLayout({ children }: { children: React.ReactNode }) {
  await requirePermissao("compras.ver");
  return (
    <div className="flex flex-col gap-5">
      <ComprasHeader />
      {children}
    </div>
  );
}
