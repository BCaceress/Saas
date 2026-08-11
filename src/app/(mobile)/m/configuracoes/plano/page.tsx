import { MobilePageHeader } from "@/components/mobile/page-header";
import { ConteudoPlano } from "@/app/(app)/configuracoes/plano/_conteudo";

export const metadata = { title: "Plano — NoHub Market" };

export default function PlanoMobilePage() {
  return (
    <div className="space-y-4">
      <MobilePageHeader
        titulo="Plano e add-ons"
        descricao="O que a assinatura cobre e o que muda ao subir."
        voltar="/m/configuracoes"
      />
      {/* Mesma pilha do desktop: os cartões de plano já empilham em uma coluna
          abaixo de `lg`, e o painel de assinatura é a primeira coisa da tela. */}
      <div className="flex flex-col gap-4">
        <ConteudoPlano />
      </div>
    </div>
  );
}
