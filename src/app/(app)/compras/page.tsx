import { redirect } from "next/navigation";

// Compras virou três módulos irmãos — Cotações, Pedidos e Recebimentos —,
// cada um com sua própria raiz. Este redirect preserva links e favoritos
// antigos; a tela de planejamento (a antiga "Compras") mora em `/cotacoes`.

export default function ComprasRedirect() {
  redirect("/cotacoes");
}
