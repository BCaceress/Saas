import { requireActiveTenant } from "@/lib/current-tenant";
import { runWithTenant } from "@/lib/tenant-context";
import { db } from "@/lib/prisma";
import { podeEmAlguma } from "@/lib/permissoes";
import { listSites } from "@/lib/sites";
import { NotasEmitidasClient } from "./_client";

export const metadata = { title: "Notas emitidas — NoHub Market" };

export default async function NotasEmitidasPage() {
  const ctx = await requireActiveTenant();

  return runWithTenant(ctx.tenant.id, async () => {
    const [docs, sites, cfg] = await Promise.all([
      db.fiscalDocument.findMany({
        orderBy: { dataEmissao: "desc" },
        take: 300,
        select: {
          id: true,
          modelo: true,
          status: true,
          serie: true,
          numero: true,
          chave: true,
          protocolo: true,
          dataEmissao: true,
          dataAutorizacao: true,
          destNome: true,
          destDocumento: true,
          valorTotal: true,
          motivoRejeicao: true,
          codigoRejeicao: true,
          contingencia: true,
          urlConsulta: true,
          siteId: true,
          saleId: true,
        },
      }),
      listSites(),
      db.fiscalConfig.findFirst({ select: { prazoCancelamentoMin: true } }),
    ]);

    const nomeSite = new Map(sites.map((s) => [s.id, s.nome]));

    return (
      <NotasEmitidasClient
        prazoCancelamentoMin={cfg?.prazoCancelamentoMin ?? 30}
        sites={sites.map((s) => ({ id: s.id, nome: s.nome }))}
        podeCancelar={podeEmAlguma(ctx.acessos, "fiscal.cancelar")}
        podeCorrigir={podeEmAlguma(ctx.acessos, "fiscal.corrigir")}
        podeBaixar={podeEmAlguma(ctx.acessos, "fiscal.baixar")}
        podeEmitir={podeEmAlguma(ctx.acessos, "fiscal.emitir")}
        notas={docs.map((d) => ({
          id: d.id,
          modelo: d.modelo,
          status: d.status,
          serie: d.serie,
          numero: d.numero,
          chave: d.chave,
          protocolo: d.protocolo,
          dataEmissao: d.dataEmissao.toISOString(),
          dataAutorizacao: d.dataAutorizacao?.toISOString() ?? null,
          destNome: d.destNome,
          destDocumento: d.destDocumento,
          valorTotal: Number(d.valorTotal),
          motivoRejeicao: d.motivoRejeicao,
          codigoRejeicao: d.codigoRejeicao,
          contingencia: d.contingencia,
          urlConsulta: d.urlConsulta,
          siteNome: nomeSite.get(d.siteId) ?? "—",
          siteId: d.siteId,
          saleId: d.saleId,
        }))}
      />
    );
  });
}
