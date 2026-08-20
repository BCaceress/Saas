import { redirect } from "next/navigation";

// Pedidos virou módulo irmão de Compras, na raiz `/pedidos`. Este redirect
// preserva links e favoritos antigos.

export default function PedidosRedirect() {
  redirect("/pedidos");
}
