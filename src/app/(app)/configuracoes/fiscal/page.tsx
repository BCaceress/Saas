import { ReceiptText } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ConteudoFiscal } from "./_conteudo";

export const metadata = { title: "Fiscal — NoHub Market" };

export default function ConfiguracoesFiscalPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Fiscal"
        icon={ReceiptText}
        description="Provedor de emissão, dados do emitente, certificado e numeração das notas."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <ConteudoFiscal />
    </div>
  );
}
