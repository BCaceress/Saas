import { Bell } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { ConteudoNotificacoes } from "./_conteudo";

export const metadata = { title: "Notificações — NoHub Market" };

export default function NotificacoesPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Notificações"
        icon={Bell}
        description="Escolha quais grupos de alerta aparecem no sino do topo."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <ConteudoNotificacoes />
    </div>
  );
}
