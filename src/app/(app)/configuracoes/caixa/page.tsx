import { Wallet } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ConteudoCaixa } from "./_conteudo";

export const metadata = { title: "Caixa — NoHub Market" };

export default function CaixaConfigPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Caixa"
        icon={Wallet}
        description="Regras do caixa do PDV: fundo de troco, limite de gaveta e controle de estoque na venda."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <ConteudoCaixa />
    </div>
  );
}
