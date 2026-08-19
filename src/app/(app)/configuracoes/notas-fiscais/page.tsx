import { FileInput } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { requirePermissao } from "@/lib/guard";
import { runWithTenant } from "@/lib/tenant-context";
import { listSites } from "@/lib/sites";
import { featureAtiva } from "@/lib/planos";
import { db } from "@/lib/prisma";
import { listarCaixas } from "@/lib/fiscal/email-inbox";
import { listarImportacoes } from "@/lib/fiscal/import-log";
import { NotasFiscaisClient } from "./_client";

export const metadata = { title: "Notas fiscais — NoHub Market" };

/**
 * As três portas de entrada do XML numa tela só: upload, e-mail e SEFAZ.
 *
 * Ficam juntas de propósito — a pergunta do operador é "como a nota do meu
 * fornecedor chega aqui?", e a resposta é escolher (ou combinar) os canais.
 */
export default async function NotasFiscaisConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ oauth?: string; motivo?: string }>;
}) {
  const ctx = await requirePermissao("fiscal.configurar");
  // O retorno do consentimento OAuth volta como querystring — vira faixa na
  // tela, não toast: o operador precisa poder reler o motivo do erro.
  const { oauth, motivo } = await searchParams;

  return runWithTenant(ctx.tenant.id, async () => {
    const [sites, caixas, historico, emitentes, config] = await Promise.all([
      listSites(),
      listarCaixas(),
      listarImportacoes({ limite: 60 }),
      db.fiscalEmitente.findMany({
        select: {
          siteId: true,
          cnpj: true,
          razaoSocial: true,
          certificadoId: true,
          certificadoTitular: true,
          certificadoValidade: true,
        },
      }),
      db.fiscalConfig.findFirst({
        select: {
          provider: true,
          ambiente: true,
          ativo: true,
          manifestacaoAutomatica: true,
        },
      }),
    ]);

    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title="Notas fiscais"
          icon={FileInput}
          description="Por onde o XML do fornecedor entra: arquivo, caixa de e-mail ou consulta à SEFAZ."
          backHref="/configuracoes"
          innerClassName="max-w-none"
        />
        <NotasFiscaisClient
          moduloLigado={featureAtiva(ctx.tenant, "fiscal")}
          sites={sites.map((s) => ({ id: s.id, nome: s.nome }))}
          caixas={caixas}
          historico={historico}
          emitentes={emitentes.map((e) => ({
            siteId: e.siteId,
            cnpj: e.cnpj,
            razaoSocial: e.razaoSocial,
            temCertificado: Boolean(e.certificadoId),
            certificadoTitular: e.certificadoTitular,
            certificadoValidade: e.certificadoValidade?.toISOString() ?? null,
          }))}
          provider={config?.provider ?? null}
          ambiente={config?.ambiente ?? null}
          providerAtivo={config?.ativo ?? false}
          manifestacaoAutomatica={config?.manifestacaoAutomatica ?? false}
          oauth={oauth === "ok" || oauth === "erro" ? oauth : null}
          oauthMotivo={motivo ?? null}
        />
      </div>
    );
  });
}
