import { MobilePageHeader } from "@/components/mobile/page-header";
import { ConteudoSites } from "@/app/(app)/configuracoes/sites/_conteudo";

export const metadata = { title: "Lojas e pontos — NoHub Market" };

export default function SitesMobilePage() {
  return (
    <div className="space-y-4">
      <MobilePageHeader
        titulo="Lojas e pontos"
        descricao="Lojas, pontos autônomos e centros de distribuição."
        voltar="/m/configuracoes"
      />
      <div className="flex flex-col gap-4">
        <ConteudoSites />
      </div>
    </div>
  );
}
