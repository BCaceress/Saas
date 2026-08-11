import { Building2 } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ConteudoEmpresa } from "./_conteudo";

export const metadata = { title: "Empresa — NoHub Market" };

export default function EmpresaPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Empresa"
        icon={Building2}
        description="Dados do seu mercado: identificação, contato e endereço."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <ConteudoEmpresa />
    </div>
  );
}
