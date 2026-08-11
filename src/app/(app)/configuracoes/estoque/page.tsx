import { Warehouse } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ConteudoEstoque } from "./_conteudo";

export const metadata = { title: "Estoque e alertas — NoHub Market" };

export default function EstoqueConfigPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Estoque e alertas"
        icon={Warehouse}
        description="Padrões de estoque e quando o sistema deve chamar sua atenção."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <ConteudoEstoque />
    </div>
  );
}
