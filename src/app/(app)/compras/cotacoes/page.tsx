import { redirect } from "next/navigation";

// Cotações virou a tela "Compras" (planejamento), na raiz do módulo. Este
// redirect preserva links e favoritos antigos; o código vive em `compras/`.

export default function CotacoesRedirect() {
  redirect("/cotacoes");
}
