import { redirect } from "next/navigation";

// A revisão de reposição virou /compras/reposicao-inteligente — este
// redirect preserva links e favoritos antigos.

export default function RevisarReposicaoRedirect() {
  redirect("/compras/reposicao-inteligente");
}
