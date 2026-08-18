import { UploadCloud } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ConteudoImportarVendas } from "./_conteudo";

export const metadata = { title: "Importar histórico de vendas — NoHub Market" };

export default function ImportarVendasPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Importar histórico de vendas"
        icon={UploadCloud}
        description="Traga o histórico de vendas de outro sistema para dentro do NoHub."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <ConteudoImportarVendas />
    </div>
  );
}
