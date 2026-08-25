import { redirect } from "next/navigation";

// A conferência só existe CONTRA um pedido: /pedidos/recebimento sem id não é
// uma tela, é um caminho de passagem. A rota fica no nav-config (ícone, título,
// rota ativa da conferência) e por isso aparece na busca — este redirect é o
// que impede que aparecer na busca vire um 404.

export default function RecebimentoIndexRedirect() {
  redirect("/pedidos");
}
