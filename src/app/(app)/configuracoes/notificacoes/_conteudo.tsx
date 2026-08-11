import { requireActiveTenant } from "@/lib/current-tenant";
import { NotificacoesClient } from "./_client";

/** Miolo das notificações — compartilhado pelo desktop e pelo `/m`. */
export async function ConteudoNotificacoes() {
  const { tenant } = await requireActiveTenant();
  return <NotificacoesClient desativados={tenant.alertasDesativados} />;
}
