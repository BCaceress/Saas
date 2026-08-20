import { redirect } from "next/navigation";

// A Cesta virou a ação "Cotar" dentro do detalhe da Compra. Este redirect
// preserva links e favoritos antigos; o código continua intacto em
// `_client.tsx` (rota dormente, sem entrada no menu).

export default function CarrinhoRedirect() {
  redirect("/cotacoes");
}
