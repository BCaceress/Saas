import { requirePermissao } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { getActiveSiteId, listSites } from "@/lib/sites";
import { podeExportar, relatoriosVisiveis } from "@/lib/relatorios/catalogo";
import { listarFavoritos } from "@/lib/relatorios/favoritos";
import { execucoesRecentes, usoPorRelatorio } from "@/lib/relatorios/historico";
import { CentralClient } from "./_central";

/**
 * Central de Relatórios — a porta única do módulo.
 *
 * A tela não calcula relatório nenhum: ela indexa o catálogo
 * (`src/lib/relatorios/catalogo.ts`), cruza com o que esta pessoa pode ver,
 * com os favoritos dela e com o uso da loja, e manda para quem executa (motor
 * de análises ou tela dedicada). É o que faz caber dezenas de relatórios sem
 * virar um menu de trinta linhas.
 */

export const dynamic = "force-dynamic";

export default async function CentralRelatoriosPage() {
  const ctx = await requirePermissao("relatorio.ver");

  const relatorios = relatoriosVisiveis(ctx.acessos);

  const { favoritos, uso, recentes, lojaAtiva } = await withTenant(ctx, async () => {
    const [favoritos, uso, recentes, sites, siteId] = await Promise.all([
      listarFavoritos(ctx.user.id),
      usoPorRelatorio(),
      execucoesRecentes(8),
      listSites(),
      getActiveSiteId(),
    ]);
    return {
      favoritos,
      uso,
      recentes,
      // A loja é filtro global do app (seletor no header); a Central só mostra
      // qual está valendo, para ninguém gerar um relatório da loja errada.
      lojaAtiva: siteId ? (sites.find((s) => s.id === siteId)?.nome ?? null) : "Todas as lojas",
    };
  });

  return (
    <CentralClient
      relatorios={relatorios}
      favoritos={favoritos}
      uso={Object.fromEntries(
        Object.entries(uso).map(([id, u]) => [
          id,
          { execucoes: u.execucoes, ultimaEm: u.ultimaEm?.toISOString() ?? null },
        ]),
      )}
      recentes={recentes.map((r) => ({
        id: r.id,
        relatorioId: r.relatorioId,
        nome: r.nome,
        formato: r.formato,
        criadoEm: r.criadoEm.toISOString(),
      }))}
      podeExportar={podeExportar(ctx.acessos)}
      lojaAtiva={lojaAtiva}
    />
  );
}
