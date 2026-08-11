import { MobilePageHeader } from "@/components/mobile/page-header";
import { ConteudoFiscal } from "@/app/(app)/configuracoes/fiscal/_conteudo";

export const metadata = { title: "Fiscal — NoHub Market" };

/** O guard de `fiscal.configurar` vem dentro do conteúdo — vale nas duas telas. */
export default function FiscalConfigMobilePage() {
  return (
    <div className="space-y-4">
      <MobilePageHeader
        titulo="Fiscal"
        descricao="Provedor, emitente, certificado e numeração."
        voltar="/m/configuracoes"
      />
      <ConteudoFiscal />
    </div>
  );
}
