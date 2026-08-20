import { requirePermissao } from "@/lib/guard";
import { CotacoesHeader } from "./_header";

/** Guard do módulo: sem a permissão, nem a URL direta abre a tela. */
export default async function CotacoesLayout({ children }: { children: React.ReactNode }) {
  await requirePermissao("compras.ver");
  return (
    <div className="flex flex-col gap-5">
      <CotacoesHeader />
      {children}
    </div>
  );
}
