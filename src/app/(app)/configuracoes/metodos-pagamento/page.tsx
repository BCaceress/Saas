import { CreditCard } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ConteudoMetodosPagamento } from "./_conteudo";

export default function MetodosPagamentoPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Métodos de pagamento"
        icon={CreditCard}
        description="Configure como sua loja recebe pagamentos no PDV e no autoatendimento."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <ConteudoMetodosPagamento />
    </div>
  );
}
