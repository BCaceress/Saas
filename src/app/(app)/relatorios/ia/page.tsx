import { redirect } from "next/navigation";

/**
 * O assistente IA deixou de ser tela própria — vive num drawer dentro do hub
 * de análises (/relatorios/lista). Redirect mantém links antigos vivos.
 */
export default function IaPage() {
  redirect("/relatorios/lista");
}
