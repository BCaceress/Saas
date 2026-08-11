import { MobilePageHeader } from "@/components/mobile/page-header";
import { ConteudoNotificacoes } from "@/app/(app)/configuracoes/notificacoes/_conteudo";

export const metadata = { title: "Notificações — NoHub Market" };

export default function NotificacoesMobilePage() {
  return (
    <div className="space-y-4">
      <MobilePageHeader
        titulo="Notificações"
        descricao="Quais grupos de alerta aparecem no sino."
        voltar="/m/configuracoes"
      />
      <ConteudoNotificacoes />
    </div>
  );
}
