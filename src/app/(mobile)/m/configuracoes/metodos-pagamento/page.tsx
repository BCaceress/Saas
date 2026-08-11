import { MobilePageHeader } from "@/components/mobile/page-header";
import { ConteudoMetodosPagamento } from "@/app/(app)/configuracoes/metodos-pagamento/_conteudo";

export const metadata = { title: "Métodos de pagamento — NoHub Market" };

export default function MetodosPagamentoMobilePage() {
  return (
    <div className="space-y-4">
      <MobilePageHeader
        titulo="Métodos de pagamento"
        descricao="Formas aceitas por loja, maquininha e Pix."
        voltar="/m/configuracoes"
      />
      <ConteudoMetodosPagamento />
    </div>
  );
}
