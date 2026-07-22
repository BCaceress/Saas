import { requirePermissao } from "@/lib/guard";

/** Guard do módulo: sem a permissão, nem a URL direta abre a tela. */
export default async function ConfiguracoesLayout({ children }: { children: React.ReactNode }) {
  await requirePermissao("config.gerenciar");
  return <>{children}</>;
}
