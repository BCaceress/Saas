import { notFound } from "next/navigation";
import { requireActiveTenant, withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { podeEmAlguma } from "@/lib/permissoes";
import { getRelatorio } from "@/lib/relatorios/catalogo";
import { getDefinicao } from "@/lib/relatorios/definicoes";
import { decodificarConfig } from "@/lib/relatorios/config";
import { configPadraoDoUsuario } from "@/lib/relatorios/modelos-salvos";
import { executarRelatorio } from "@/lib/relatorios/executar";
import { FolhaRelatorio } from "../_folha-relatorio";

/**
 * Documento imprimível de QUALQUER relatório do motor genérico.
 *
 * Uma rota para todos: o relatório vem em `?rel=` e a configuração do operador
 * em `?c=`, então o papel sai com exatamente as colunas, a ordem e os filtros
 * da prévia. A escolha de orientação, largura e escala é da folha
 * (`_folha-relatorio.tsx`), a partir do plano calculado pelo motor.
 *
 * Substitui a família `/documento/[modelo]`, que continua existindo para os
 * modelos fixos ainda referenciados pelo catálogo.
 */

export const dynamic = "force-dynamic";

export default async function DocumentoRelatorioPage({
  searchParams,
}: {
  searchParams: Promise<{ rel?: string; c?: string; imprimir?: string }>;
}) {
  const { rel: relatorioId, c, imprimir } = await searchParams;

  const rel = relatorioId ? getRelatorio(relatorioId) : null;
  const def = rel ? getDefinicao(rel.id) : null;
  if (!rel || !def) notFound();

  const ctx = await requireActiveTenant();
  if (!podeEmAlguma(ctx.acessos, rel.permissao)) notFound();

  const resultado = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    const sites = await listSites();
    // Sem `?c=` (exportar direto do card), vale o padrão desta pessoa — é o
    // mesmo que "Visualizar" mostra. Cair no padrão de fábrica aqui faria o
    // arquivo divergir da tela, que é justamente o que o fluxo promete não fazer.
    const config = decodificarConfig(c) ?? (await configPadraoDoUsuario(def, ctx.user.id)) ?? {};
    return executarRelatorio({
      def,
      config,
      acessos: ctx.acessos,
      siteId,
      siteNome: siteId ? (sites.find((s) => s.id === siteId)?.nome ?? null) : null,
      policy: policyDoTenant(ctx.tenant),
    });
  });

  return (
    <FolhaRelatorio
      tenantNome={ctx.tenant.nome}
      resultado={resultado}
      autoImprimir={imprimir === "1"}
    />
  );
}
