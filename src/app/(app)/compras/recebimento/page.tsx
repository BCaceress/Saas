import { redirect } from "next/navigation";

// Recebimento não é mais módulo: virou o fluxo "Receber mercadoria" dentro de
// Pedidos. Este redirect preserva links e favoritos antigos.

export default function RecebimentoRedirect() {
  redirect("/pedidos");
}
