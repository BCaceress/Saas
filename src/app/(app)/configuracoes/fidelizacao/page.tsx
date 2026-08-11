import { Gift } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ConteudoFidelizacao } from "./_conteudo";

export const metadata = { title: "Fidelização — NoHub Market" };

export default function FidelizacaoPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Fidelização"
        icon={Gift}
        description="Defina como os cupons de retorno e aniversário são enviados aos clientes."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <ConteudoFidelizacao />
    </div>
  );
}
