import { requirePermissaoMobile } from "@/lib/guard";

/**
 * Guard do módulo no `/m` — o mesmo de `(app)/configuracoes`, com a diferença
 * de para onde manda quem não pode: aqui a saída é a home do celular, não a do
 * desktop. Esconder a linha no "Mais" é cosmético; quem digita a URL entra.
 */
export default async function ConfiguracoesMobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePermissaoMobile("config.gerenciar");
  return <>{children}</>;
}
