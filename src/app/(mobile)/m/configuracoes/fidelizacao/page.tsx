import { MobilePageHeader } from "@/components/mobile/page-header";
import { ConteudoFidelizacao } from "@/app/(app)/configuracoes/fidelizacao/_conteudo";

export const metadata = { title: "Fidelização — NoHub Market" };

export default function FidelizacaoMobilePage() {
  return (
    <div className="space-y-4">
      <MobilePageHeader
        titulo="Fidelização"
        descricao="Cupons de retorno e aniversário, faixas de pontos."
        voltar="/m/configuracoes"
      />
      <ConteudoFidelizacao />
    </div>
  );
}
