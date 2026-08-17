import { requireActiveTenant } from "@/lib/current-tenant";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { resolverAlertas } from "@/lib/alertas/catalogo";
import { NotificacoesClient } from "./_client";

/** Miolo das notificações — compartilhado pelo desktop e pelo `/m`. */
export async function ConteudoNotificacoes() {
  const { tenant } = await requireActiveTenant();
  // A estratégia de estoque decide quais alertas existem; a resolução já vem
  // pronta do servidor (com o fallback do formato antigo aplicado), então a
  // tela nunca precisa saber que existiu um formato antigo.
  const policy = policyDoTenant(tenant);
  return (
    <NotificacoesClient
      policy={policy}
      resolucao={resolverAlertas(tenant, policy)}
      limiares={{
        inventarioAtrasoDias: tenant.inventarioAtrasoDias,
        novoSemMovDias: tenant.novoSemMovDias,
      }}
      pushHoraInicio={tenant.pushHoraInicio}
      pushHoraFim={tenant.pushHoraFim}
    />
  );
}
