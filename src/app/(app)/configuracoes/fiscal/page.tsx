import { ReceiptText } from "lucide-react";
import { requirePermissao } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { listSites } from "@/lib/sites";
import { featureAtiva } from "@/lib/planos";
import { db } from "@/lib/prisma";
import { PageHeader } from "@/components/app/page-header";
import { FiscalConfigClient } from "./_client";

export const metadata = { title: "Fiscal — NoHub Market" };

export default async function ConfiguracoesFiscalPage() {
  const ctx = await requirePermissao("fiscal.configurar");

  return runWithTenant(ctx.tenant.id, async () => {
    const sites = await listSites();
    const [config, emitentes, series] = await Promise.all([
      db.fiscalConfig.findFirst({
        select: {
          provider: true,
          ambiente: true,
          ativo: true,
          emissaoAutomaticaNfce: true,
          prazoCancelamentoMin: true,
          // O token NUNCA volta para a tela — só se ele existe.
          apiToken: true,
          webhookSecret: true,
        },
      }),
      db.fiscalEmitente.findMany({
        orderBy: { createdAt: "asc" },
        select: {
          siteId: true,
          cnpj: true,
          razaoSocial: true,
          nomeFantasia: true,
          ie: true,
          im: true,
          cnae: true,
          regime: true,
          cep: true,
          logradouro: true,
          numero: true,
          complemento: true,
          bairro: true,
          municipio: true,
          codigoMunicipio: true,
          uf: true,
          telefone: true,
          cscId: true,
          csc: true,
          naturezaOperacaoPadrao: true,
          certificadoTitular: true,
          certificadoValidade: true,
        },
      }),
      db.fiscalSerie.findMany({
        orderBy: [{ modelo: "asc" }, { serie: "asc" }],
        select: {
          siteId: true,
          modelo: true,
          serie: true,
          proximoNumero: true,
          ativa: true,
        },
      }),
    ]);

    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title="Fiscal"
          icon={ReceiptText}
          description="Provedor de emissão, dados do emitente, certificado e numeração das notas."
          backHref="/configuracoes"
          innerClassName="max-w-none"
        />
        <FiscalConfigClient
          moduloLigado={featureAtiva(ctx.tenant, "fiscal")}
          sites={sites.map((s) => ({ id: s.id, nome: s.nome }))}
          config={
            config
              ? {
                  provider: config.provider,
                  ambiente: config.ambiente,
                  ativo: config.ativo,
                  emissaoAutomaticaNfce: config.emissaoAutomaticaNfce,
                  prazoCancelamentoMin: config.prazoCancelamentoMin,
                  temToken: Boolean(config.apiToken),
                  temWebhookSecret: Boolean(config.webhookSecret),
                }
              : null
          }
          emitentes={emitentes.map(({ csc, certificadoValidade, ...e }) => ({
            ...e,
            // Segredo não volta para o browser — a tela só precisa saber que existe.
            temCsc: Boolean(csc),
            certificadoValidade: certificadoValidade?.toISOString() ?? null,
          }))}
          series={series}
        />
      </div>
    );
  });
}
