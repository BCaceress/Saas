import { requirePermissao } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { listarSalvos } from "@/lib/analises/salvos";
import { getFato } from "@/lib/analises/catalogo";
import { descreverDSL } from "@/lib/analises/formato";
import { HubAnalises, type SalvoCard } from "./_hub";

/**
 * Hub inteligente de análises (tela única). Três prateleiras — os relatórios
 * que a casa guardou, o catálogo de modelos e os documentos recentes — com a
 * busca do topo servindo as três e o assistente de IA em drawer. Relatórios
 * detalhados continuam em /relatorios/{tipo}; PDFs em /documento/{modelo}.
 */
export default async function ListaRelatoriosPage() {
  const ctx = await requirePermissao("relatorio.ver");

  const salvos = await withTenant(ctx, async () => {
    const linhas = await listarSalvos(ctx.user.id);
    return linhas.flatMap<SalvoCard>((s) => {
      const fato = getFato(s.consulta.fato);
      // Consulta de um fato que saiu do catálogo não vira card morto.
      if (!fato) return [];
      return [
        {
          id: s.id,
          nome: s.nome,
          descricao: s.descricao,
          resumo: descreverDSL(fato, s.consulta),
          meu: s.meu,
          sistema: s.sistema,
        },
      ];
    });
  });

  return <HubAnalises salvos={salvos} />;
}
