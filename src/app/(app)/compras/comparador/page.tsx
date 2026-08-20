import { redirect } from "next/navigation";

// O Comparador virou a ação "Cotar" dentro do detalhe da Compra — a régua de
// preço contra o catálogo mora lá agora. Este redirect preserva links e
// favoritos antigos; o código do Comparador continua intacto em `_client.tsx`
// (rota dormente, sem entrada no menu).

export default function ComparadorRedirect() {
  redirect("/cotacoes");
}
