import { MobilePageHeader } from "@/components/mobile/page-header";
import { ConteudoCaixa } from "@/app/(app)/configuracoes/caixa/_conteudo";

export const metadata = { title: "Caixa — NoHub Market" };

export default function CaixaConfigMobilePage() {
  return (
    <div className="space-y-4">
      <MobilePageHeader
        titulo="Caixa"
        descricao="Fundo de troco, limite de gaveta e estoque na venda."
        voltar="/m/configuracoes"
      />
      <ConteudoCaixa />
    </div>
  );
}
