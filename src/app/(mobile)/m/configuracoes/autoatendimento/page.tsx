import { MobilePageHeader } from "@/components/mobile/page-header";
import { ConteudoAutoatendimento } from "@/app/(app)/configuracoes/autoatendimento/_conteudo";

export const metadata = { title: "Autoatendimento — NoHub Market" };

/**
 * A tela mais provável de ser aberta do próprio tablet: o quiosque roda nele, e
 * o PIN de saída se define ao lado do aparelho, não no computador do escritório.
 */
export default function AutoatendimentoConfigMobilePage() {
  return (
    <div className="space-y-4">
      <MobilePageHeader
        titulo="Autoatendimento"
        descricao="PIN de saída do modo quiosque."
        voltar="/m/configuracoes"
      />
      <ConteudoAutoatendimento />
    </div>
  );
}
