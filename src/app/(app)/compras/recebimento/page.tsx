import { redirect } from "next/navigation";

// Recebimentos virou módulo irmão de Compras, na raiz `/recebimento`. Este
// redirect preserva links e favoritos antigos.

export default function RecebimentoRedirect() {
  redirect("/recebimento");
}
