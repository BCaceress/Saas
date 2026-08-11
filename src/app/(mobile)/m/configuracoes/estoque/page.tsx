import { MobilePageHeader } from "@/components/mobile/page-header";
import { ConteudoEstoque } from "@/app/(app)/configuracoes/estoque/_conteudo";

export const metadata = { title: "Estoque e alertas — NoHub Market" };

export default function EstoqueConfigMobilePage() {
  return (
    <div className="space-y-4">
      <MobilePageHeader
        titulo="Estoque e alertas"
        descricao="Padrões de estoque e quando o sistema chama sua atenção."
        voltar="/m/configuracoes"
      />
      <ConteudoEstoque />
    </div>
  );
}
