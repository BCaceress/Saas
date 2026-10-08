import { ListChecks } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ConteudoCadastro } from "./_conteudo";

export const metadata = { title: "Campos do cadastro — NoHub Market" };

export default function CadastroConfigPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Campos do cadastro"
        icon={ListChecks}
        description="Esconda o que sua operação não preenche. Nada é apagado."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <ConteudoCadastro />
    </div>
  );
}
