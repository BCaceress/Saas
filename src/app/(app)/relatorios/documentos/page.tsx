import { redirect } from "next/navigation";

/**
 * O catálogo de documentos foi absorvido pelo hub de análises: cada card gera
 * PDF direto e os recentes aparecem em /relatorios/lista#documentos.
 */
export default function DocumentosPage() {
  redirect("/relatorios/lista#documentos");
}
