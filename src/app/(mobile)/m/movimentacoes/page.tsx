import { requirePermissaoMobile } from "@/lib/guard";
import { withTenant } from "@/lib/current-tenant";
import { getActiveSiteId } from "@/lib/sites";
import { loadMovimentacoes } from "@/app/(app)/estoque/_data";
import { MobilePageHeader } from "@/components/mobile/page-header";
import { MovimentacoesClient } from "./_client";
import { CHIPS, resolvePeriodo } from "./_filtros";

/**
 * Extrato do estoque no celular — "o que mexeu, quando e por quê".
 *
 * É o destino do "Ver todas" da home, que mostra as três últimas. A fonte é a
 * mesma do desktop (`loadMovimentacoes`): toda operação que muda saldo passa
 * pelo `StockMovement`, então uma leitura ordenada responde venda, entrada,
 * contagem, perda e transferência de uma vez.
 *
 * Divisão de trabalho dos filtros: TIPO e PERÍODO recortam no banco (viram URL,
 * porque mudam o conjunto e precisam sobreviver ao voltar do navegador); a
 * BUSCA filtra na memória do aparelho, sobre o que já desceu — ir ao servidor
 * a cada letra digitada custaria mais que a página inteira.
 */
export default async function MovimentacoesMobilePage({
  searchParams,
}: {
  searchParams: Promise<{
    tipo?: string;
    periodo?: string;
    de?: string;
    ate?: string;
    n?: string;
  }>;
}) {
  const ctx = await requirePermissaoMobile("estoque.ver");
  const sp = await searchParams;

  const chip = CHIPS.some((c) => c.valor === sp.tipo) ? sp.tipo! : "todos";
  const periodo = resolvePeriodo(sp);
  // Página crescente em vez de rolagem infinita: o "Ver mais" vira URL, então
  // quem volta para a tela cai onde estava. Teto de 300 — acima disso a
  // pergunta é de relatório, não de extrato de bolso.
  const porPagina = Math.min(Math.max(Number.parseInt(sp.n ?? "50", 10) || 50, 50), 300);

  const dados = await withTenant(ctx, async () => {
    const siteId = await getActiveSiteId();
    return loadMovimentacoes(siteId, {
      chip: chip === "todos" ? undefined : chip,
      de: periodo.de,
      ate: periodo.ate,
      pagina: 1,
      porPagina,
    });
  });

  return (
    <>
      <MobilePageHeader
        titulo="Movimentações"
        descricao="Tudo que mexeu no estoque."
        voltar="/m"
      />
      <MovimentacoesClient
        linhas={dados.rows.map((r) => ({
          id: r.id,
          productId: r.productId,
          produto: r.productNome,
          sku: r.productSku,
          tipo: r.tipo,
          origem: r.origem,
          documento: r.documento,
          responsavel: r.responsavel,
          observacao: r.observacao,
          delta: r.deltaFechado || r.deltaAberto,
          saldoDepois: r.saldoDepois,
          em: r.createdAt.toISOString(),
        }))}
        total={dados.total}
        mostrando={dados.rows.length}
        chip={chip}
        periodo={periodo.valor}
        periodoLabel={periodo.label}
        de={periodo.deInput}
        ate={periodo.ateInput}
        porPagina={porPagina}
      />
    </>
  );
}
