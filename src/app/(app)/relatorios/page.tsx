import { requirePermissao } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { podeExportar, relatoriosVisiveis } from "@/lib/relatorios/catalogo";
import { listarFavoritos } from "@/lib/relatorios/favoritos";
import { usoPorRelatorio } from "@/lib/relatorios/historico";
import { CentralClient } from "./_central";

/**
 * Central de Relatórios — a porta única do módulo, na raiz `/relatorios`.
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

  const { favoritos, uso } = await withTenant(ctx, async () => {
    const [favoritos, uso] = await Promise.all([
      listarFavoritos(ctx.user.id),
      usoPorRelatorio(),
    ]);
    return { favoritos, uso };
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
      podeExportar={podeExportar(ctx.acessos)}
    />
  );
}
