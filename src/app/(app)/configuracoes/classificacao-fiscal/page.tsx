import { Scale } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ConteudoClassificacaoFiscal } from "./_conteudo";

export default function ClassificacaoFiscalPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Classificação fiscal"
        icon={Scale}
        description="Perfis fiscais (NCM/CEST) e o vínculo padrão de cada subcategoria."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <ConteudoClassificacaoFiscal />
    </div>
  );
}
