import { MessageCircle } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { requireFeature } from "@/lib/guard";
import { configDoTenant, tokenDeVerificacao } from "@/lib/whatsapp";
import { rootUrl } from "@/lib/urls";
import { ConfiguracaoWhatsApp } from "./_client";

// A tela só existe para quem contratou o add-on. Sem ele, `requireFeature`
// manda para a página de planos — é upsell, não erro.

export default async function WhatsAppPage() {
  const ctx = await requireFeature("compras.whatsapp");
  const cfg = await configDoTenant(ctx.tenant.id);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="WhatsApp"
        icon={MessageCircle}
        description="Ligue o disparo automático das cotações: a mensagem sai daqui, sem abrir o aplicativo contato por contato."
        backHref="/configuracoes"
        innerClassName="max-w-none"
      />
      <ConfiguracaoWhatsApp
        inicial={
          cfg && {
            provider: cfg.provider,
            ativo: cfg.ativo,
            phoneNumberId: cfg.phoneNumberId,
            wabaId: cfg.wabaId ?? "",
            numeroExibicao: cfg.numeroExibicao ?? "",
            templateNome: cfg.templateNome,
            templateIdioma: cfg.templateIdioma,
            // Credencial nunca volta para a tela — só o fato de existir.
            temToken: Boolean(cfg.accessToken),
            temAppSecret: Boolean(cfg.appSecret),
          }
        }
        webhookUrl={rootUrl(`/api/webhooks/whatsapp/${ctx.tenant.id}`)}
        verifyToken={tokenDeVerificacao(ctx.tenant.id)}
      />
    </div>
  );
}
