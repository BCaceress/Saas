import { redirect } from "next/navigation";

// A revisão de reposição virou /cotacoes/reposicao-inteligente — este
// redirect preserva links e favoritos antigos.

export default function RevisarReposicaoRedirect() {
  redirect("/cotacoes/reposicao-inteligente");
}
