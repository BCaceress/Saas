import { redirect } from "next/navigation";

// A inteligência de reposição (sugestões, agrupamento por fornecedor,
// previsão de ruptura) vive exclusivamente no módulo de Reposições.
export default function ReposicaoPage() {
  redirect("/compras");
}
