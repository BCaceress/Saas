import { MobilePageHeader } from "@/components/mobile/page-header";
import { ConteudoClassificacaoFiscal } from "@/app/(app)/configuracoes/classificacao-fiscal/_conteudo";

export const metadata = { title: "Classificação fiscal — NoHub Market" };

export default function ClassificacaoFiscalMobilePage() {
  return (
    <div className="space-y-4">
      <MobilePageHeader
        titulo="Classificação fiscal"
        descricao="Perfis NCM/CEST e vínculo por subcategoria."
        voltar="/m/configuracoes"
      />
      <ConteudoClassificacaoFiscal />
    </div>
  );
}
