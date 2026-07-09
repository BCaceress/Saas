import { Bell } from "lucide-react";
import { requireActiveTenant } from "@/lib/current-tenant";
import { PageHeader } from "@/components/app/page-header";
import { NotificacoesClient } from "./_client";

export const metadata = { title: "Notificações — NoHub Market" };

export default async function NotificacoesPage() {
  const { tenant } = await requireActiveTenant();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Notificações"
        icon={Bell}
        description="Escolha quais grupos de alerta aparecem no sino do topo."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <NotificacoesClient desativados={tenant.alertasDesativados} />
    </div>
  );
}
