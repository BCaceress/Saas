import { MonitorSmartphone } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ConteudoAutoatendimento } from "./_conteudo";

export const metadata = { title: "Autoatendimento — NoHub Market" };

export default function AutoatendimentoConfigPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Autoatendimento"
        icon={MonitorSmartphone}
        description="Modo quiosque do totem: PIN de saída e acesso à tela."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <ConteudoAutoatendimento />
    </div>
  );
}
