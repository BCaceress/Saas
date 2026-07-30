import { notFound } from "next/navigation";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { podeEmAlguma } from "@/lib/permissoes";
import { decodificarConsulta } from "@/lib/analises/schema";
import { executarConsulta } from "@/lib/analises/motor";
import { descreverConsulta, paraDocumento } from "@/lib/analises/formato";
import { FolhaDocumento } from "../_folha";

/**
 * Documento PDF do relatório sob demanda. Mesma folha A4 dos modelos fixos,
 * mesmo motor da tela — o que muda é só a origem do conteúdo: uma consulta
 * codificada em `?q=` em vez de um modelo do catálogo.
 */

export const dynamic = "force-dynamic";

export default async function DocumentoConsultaPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = await requireActiveTenant();
  if (!podeEmAlguma(ctx.acessos, "relatorio.ver")) notFound();

  const { q } = await searchParams;
  const consulta = decodificarConsulta(q);
  if (!consulta) notFound();

  const { resultado, siteNome } = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const [resultado, sites] = await Promise.all([
      executarConsulta({
        consulta,
        acessos: ctx.acessos,
        siteId,
        policy: policyDoTenant(ctx.tenant),
      }),
      listSites(),
    ]);
    return {
      resultado,
      siteNome: siteId ? (sites.find((s) => s.id === siteId)?.nome ?? null) : null,
    };
  });

  return (
    <FolhaDocumento
      tenantNome={ctx.tenant.nome}
      titulo={resultado.fato.label}
      descricao={descreverConsulta(resultado)}
      periodoLabel={resultado.fato.usaPeriodo ? resultado.periodo.label : null}
      siteNome={siteNome}
      doc={paraDocumento(resultado)}
    />
  );
}
