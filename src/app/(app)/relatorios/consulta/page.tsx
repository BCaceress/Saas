import { requirePermissao } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { policyDoTenant } from "@/lib/estoque-estrategia";
import { catalogoParaCliente, CATALOGO } from "@/lib/analises/catalogo";
import { consultaSchema, decodificarConsulta, type Consulta } from "@/lib/analises/schema";
import { ConsultaInvalidaError, executarConsulta } from "@/lib/analises/motor";
import { descreverConsulta } from "@/lib/analises/formato";
import { abrirSalvo } from "@/lib/analises/salvos";
import { ConsultaClient } from "./_client";

/**
 * Relatório sob demanda. A consulta inteira viaja na URL (`?q=`), então o
 * resultado é recarregável, compartilhável e exportável sem estado de servidor
 * — e voltar no navegador desfaz o último ajuste, que é o que se espera.
 */

export const dynamic = "force-dynamic";

/** Consulta inicial quando alguém abre a tela sem `q`. */
function consultaPadrao(): Consulta {
  const fato = CATALOGO[0];
  return consultaSchema.parse({
    fato: fato.id,
    dimensoes: fato.padrao.dimensoes,
    metricas: fato.padrao.metricas,
    periodo: { preset: "30d" },
  });
}

export default async function ConsultaPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; salvo?: string }>;
}) {
  const ctx = await requirePermissao("relatorio.ver");
  const { q, salvo: salvoId } = await searchParams;

  // `?salvo=` abre um relatório guardado; `?q=` é a consulta crua da URL. O
  // salvo vence — quem clicou no nome quer aquele relatório, não o que estava
  // na barra de endereço.
  const salvo = salvoId ? await withTenant(ctx, () => abrirSalvo(salvoId, ctx.user.id)) : null;
  const consulta = salvo?.consulta ?? decodificarConsulta(q) ?? consultaPadrao();

  const { resultado, erro } = await withTenant(ctx, async () => {
    try {
      return {
        resultado: await executarConsulta({
          consulta,
          acessos: ctx.acessos,
          siteId: await getActiveSiteId(),
          policy: policyDoTenant(ctx.tenant),
        }),
        erro: null,
      };
    } catch (e) {
      if (e instanceof ConsultaInvalidaError) return { resultado: null, erro: e.message };
      throw e;
    }
  });

  return (
    <ConsultaClient
      consulta={resultado?.consulta ?? consulta}
      catalogo={catalogoParaCliente(ctx.acessos)}
      resultado={
        resultado && {
          colunas: resultado.colunas,
          linhas: resultado.linhas,
          brutas: resultado.brutas,
          variacoes: resultado.variacoes,
          totaisTexto: resultado.totaisTexto,
          totais: resultado.totais,
          totalGrupos: resultado.totalGrupos,
          truncado: resultado.truncado,
          metricasRemovidas: resultado.metricasRemovidas,
          filtrosRemovidos: resultado.filtrosRemovidos,
          periodoLabel: resultado.periodo.label,
          descricao: descreverConsulta(resultado),
        }
      }
      salvo={salvo && { id: salvo.id, nome: salvo.nome, meu: salvo.meu, sistema: salvo.sistema }}
      erro={erro}
    />
  );
}
