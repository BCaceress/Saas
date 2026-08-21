import { redirect } from "next/navigation";

// A fila de recebimento deixou de ser tela própria: receber mercadoria começa
// no pedido, em /pedidos ("Receber mercadoria"). Este redirect preserva
// favoritos e links antigos.

export default function RecebimentoRedirect() {
  redirect("/pedidos");
}
