import { notFound } from "next/navigation";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { resolvePeriodo } from "@/lib/periodo";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { getModelo } from "@/app/(app)/relatorios/_modelos";
import { montarDocumento } from "@/app/(app)/relatorios/_documento-data";
import type { Range } from "@/app/(app)/relatorios/_data";
import { FolhaDocumento } from "../_folha";

/**
 * Documento PDF de um modelo fixo do catálogo. A folha A4 (cabeçalho, KPIs,
 * tabelas, rodapé) mora em `_folha.tsx` e é a mesma do relatório sob demanda —
 * aqui só resolvemos QUAL conteúdo imprimir.
 */

export const dynamic = "force-dynamic";

export default async function DocumentoPage({
  params,
  searchParams,
}: {
  params: Promise<{ modelo: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { modelo } = await params;
  const modeloDef = getModelo(modelo);
  if (!modeloDef) notFound();

  const ctx = await requireActiveTenant();
  const sp = await searchParams;
  const periodo = resolvePeriodo(sp);
  const range: Range = { inicio: periodo.inicio, fim: periodo.fim };

  const { doc, siteNome } = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const [doc, sites] = await Promise.all([
      montarDocumento(modeloDef.id, range, siteId, policyDoTenant(ctx.tenant)),
      listSites(),
    ]);
    const siteNome = siteId ? (sites.find((s) => s.id === siteId)?.nome ?? null) : null;
    return { doc, siteNome };
  });

  return (
    <FolhaDocumento
      tenantNome={ctx.tenant.nome}
      titulo={modeloDef.nome}
      descricao={modeloDef.descricao}
      periodoLabel={modeloDef.usaPeriodo ? periodo.label : null}
      siteNome={siteNome}
      doc={doc}
    />
  );
}
