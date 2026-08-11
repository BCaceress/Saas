import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ConteudoPlano } from "./_conteudo";

export const metadata = { title: "Plano — NoHub Market" };

export default function PlanoPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Plano e add-ons"
        icon={Sparkles}
        description="O que sua assinatura cobre hoje e o que muda ao subir de plano."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <ConteudoPlano />
    </div>
  );
}
