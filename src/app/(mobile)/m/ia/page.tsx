import { redirect } from "next/navigation";
import { carregarShell } from "@/lib/shell-context";
import { featureAtiva } from "@/lib/planos";
import { rotaInicialMobile } from "@/components/mobile/nav";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { IaClient } from "./_client";

/**
 * NoHub IA em tela cheia.
 *
 * No desktop o copiloto é um painel lateral sobre a tela que a pessoa estava
 * usando. No celular não existe "ao lado": o painel cobria tudo de qualquer
 * jeito, e o botão flutuante que o abria disputava o polegar com a barra de
 * abas. Aqui ele é uma tela como as outras, alcançada por "Mais".
 *
 * Mesmo portão do desktop: add-on de IA no plano + perfil administrador. Quem
 * não passa volta para a home do `/m` em vez de cair na tela de planos, que é
 * de mesa.
 */
export default async function IaMobilePage() {
  const { ctx, toggles, admin } = await carregarShell();

  if (!featureAtiva(ctx.tenant, "ia.copiloto") || !admin) {
    redirect(rotaInicialMobile(ctx.acessos, toggles));
  }

  return (
    <>
      <MobilePageHeader
        titulo="NoHub IA"
        descricao="Pergunte sobre vendas, estoque, compras e relatórios."
        voltar="/m/mais"
      />
      <IaClient />
    </>
  );
}
