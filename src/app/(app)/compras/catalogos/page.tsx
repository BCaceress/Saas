import { redirect } from "next/navigation";

// As tabelas de preço deixaram de ser uma tela de Compras: cada catálogo
// pertence ao seu fornecedor. Este redirect preserva links e favoritos antigos.

export default function CatalogosRedirect() {
  redirect("/fornecedores");
}
