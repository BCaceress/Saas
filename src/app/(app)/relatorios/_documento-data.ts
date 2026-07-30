import "server-only";
import { brl } from "@/lib/utils";
import { pct } from "@/lib/periodo";
import { POLICY_PADRAO, type EstoquePolicy } from "@/lib/estoque-estrategia";
import {
  resumoVendas,
  mixPagamento,
  rankingProdutos,
  curvaABC,
  perdas,
  posicaoEstoque,
  ruptura,
  comprasPorProduto,
  comprasPorFornecedor,
  fechamentosCaixa,
  valorEstoqueAtual,
  type Range,
} from "./_data";
import type { ModeloId } from "./_modelos";

/**
 * Gera o conteúdo normalizado de cada documento PDF a partir da camada de dados
 * dos relatórios. Tudo já vem formatado em pt-BR (string) — a página de documento
 * só pinta. Roda sob contexto de tenant (via `db` nas funções de `_data`).
 */

// A forma do documento é definida junto com a folha que o imprime — uma
// definição só, usada pelos modelos fixos e pelo relatório sob demanda.
export type { DocKpi, DocSecao, DocumentoData } from "@/app/documento/_folha";
import type { DocumentoData } from "@/app/documento/_folha";

const D = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

export async function montarDocumento(
  modelo: ModeloId,
  range: Range,
  siteId: string | null,
  policy: EstoquePolicy = POLICY_PADRAO,
): Promise<DocumentoData> {
  switch (modelo) {
    case "vendas-resumo": {
      const [r, mix, ranking] = await Promise.all([
        resumoVendas(range, siteId),
        mixPagamento(range, siteId),
        rankingProdutos(range, siteId),
      ]);
      const totalMix = mix.reduce((s, m) => s + m.valor, 0) || 1;
      return {
        kpis: [
          { label: "Faturamento", valor: brl(r.faturamento), hint: `${r.numVendas} vendas` },
          { label: "Ticket médio", valor: brl(r.ticket) },
          { label: "CMV", valor: brl(r.cmv) },
          { label: "Margem bruta", valor: brl(r.margemBruta), hint: pct(r.margemPct, 1) },
        ],
        secoes: [
          {
            titulo: "Mix de pagamento",
            colunas: [{ header: "Método" }, { header: "Valor", align: "right" }, { header: "Participação", align: "right" }],
            linhas: mix.map((m) => [m.metodo, brl(m.valor), pct((m.valor / totalMix) * 100, 1)]),
            vazio: "Sem pagamentos confirmados no período.",
          },
          {
            titulo: "Produtos mais vendidos",
            subtitulo: "Top 20 por faturamento",
            colunas: [{ header: "Produto" }, { header: "SKU" }, { header: "Qtd", align: "right" }, { header: "Faturamento", align: "right" }],
            linhas: ranking.slice(0, 20).map((p) => [p.nome, p.sku, D(p.quantidade), brl(p.receita)]),
            vazio: "Nenhuma venda no período.",
          },
        ],
      };
    }

    case "margem-produto": {
      const ranking = await rankingProdutos(range, siteId);
      return {
        kpis: [
          { label: "Receita total", valor: brl(ranking.reduce((s, p) => s + p.receita, 0)) },
          { label: "CMV total", valor: brl(ranking.reduce((s, p) => s + p.custo, 0)) },
          { label: "Margem total", valor: brl(ranking.reduce((s, p) => s + p.margem, 0)) },
          { label: "Produtos", valor: String(ranking.length) },
        ],
        secoes: [
          {
            titulo: "Margem por produto",
            colunas: [{ header: "Produto" }, { header: "SKU" }, { header: "Receita", align: "right" }, { header: "CMV", align: "right" }, { header: "Margem", align: "right" }, { header: "Margem %", align: "right" }],
            linhas: ranking.map((p) => [p.nome, p.sku, brl(p.receita), brl(p.custo), brl(p.margem), pct(p.margemPct, 1)]),
            vazio: "Nenhuma venda no período.",
          },
        ],
      };
    }

    case "abc": {
      const abc = await curvaABC(range, siteId);
      const porClasse = (c: "A" | "B" | "C") => abc.filter((p) => p.classe === c);
      return {
        kpis: [
          { label: "Classe A", valor: String(porClasse("A").length), hint: "até 80% da receita" },
          { label: "Classe B", valor: String(porClasse("B").length), hint: "80–95%" },
          { label: "Classe C", valor: String(porClasse("C").length), hint: "cauda" },
          { label: "Faturamento", valor: brl(abc.reduce((s, p) => s + p.receita, 0)) },
        ],
        secoes: [
          {
            titulo: "Curva ABC por faturamento",
            colunas: [{ header: "Classe" }, { header: "Produto" }, { header: "SKU" }, { header: "Faturamento", align: "right" }, { header: "% acum.", align: "right" }],
            linhas: abc.map((p) => [p.classe, p.nome, p.sku, brl(p.receita), pct(p.acumuladoPct, 1)]),
            vazio: "Nenhuma venda no período.",
          },
        ],
      };
    }

    case "caixa": {
      const fechamentos = await fechamentosCaixa(range, siteId);
      const quebraTotal = fechamentos.reduce((s, f) => s + (f.quebra ?? 0), 0);
      return {
        kpis: [
          { label: "Fechamentos", valor: String(fechamentos.length) },
          { label: "Vendas em dinheiro", valor: brl(fechamentos.reduce((s, f) => s + f.vendasDinheiro, 0)) },
          { label: "Quebra acumulada", valor: brl(quebraTotal) },
        ],
        secoes: [
          {
            titulo: "Sessões fechadas",
            colunas: [{ header: "Fechado em" }, { header: "Caixa" }, { header: "Abertura", align: "right" }, { header: "Vendas dinheiro", align: "right" }, { header: "Esperado", align: "right" }, { header: "Contado", align: "right" }, { header: "Quebra", align: "right" }],
            linhas: fechamentos.map((f) => [
              f.fechadaEm ? f.fechadaEm.toLocaleDateString("pt-BR") : "—",
              f.siteNome,
              brl(f.valorAbertura),
              brl(f.vendasDinheiro),
              brl(f.esperado),
              f.contado != null ? brl(f.contado) : "—",
              f.quebra != null ? brl(f.quebra) : "—",
            ]),
            vazio: "Nenhuma sessão de caixa fechada no período.",
          },
        ],
      };
    }

    case "perdas": {
      const r = await perdas(range, siteId);
      return {
        kpis: [
          { label: "Custo das perdas", valor: brl(r.total) },
          { label: "Itens afetados", valor: String(r.itens.length) },
        ],
        secoes: [
          {
            titulo: "Perdas por produto",
            colunas: [{ header: "Produto" }, { header: "SKU" }, { header: "Qtd", align: "right" }, { header: "Custo", align: "right" }],
            linhas: r.itens.map((p) => [p.nome, p.sku, D(p.quantidade), brl(p.custo)]),
            vazio: "Nenhuma perda registrada no período.",
          },
        ],
      };
    }

    case "estoque-posicao": {
      const [linhas, valor] = await Promise.all([
        posicaoEstoque(siteId, policy),
        valorEstoqueAtual(siteId),
      ]);
      const abaixo = policy.usaGiro
        ? linhas.filter((l) => l.estoqueFechado <= 0).length
        : linhas.filter((l) => l.abaixoMinimo).length;
      return {
        kpis: [
          { label: "Valor em estoque", valor: brl(valor) },
          { label: "SKUs", valor: String(linhas.length) },
          { label: policy.usaGiro ? "Sem estoque" : "Abaixo do mínimo", valor: String(abaixo) },
        ],
        secoes: [
          {
            titulo: "Posição de estoque",
            subtitulo: "Saldo ao vivo no momento da emissão",
            colunas: [{ header: "Produto" }, { header: "SKU" }, { header: "Site" }, { header: "Fechado", align: "right" }, { header: "Aberto", align: "right" }, { header: "Custo médio", align: "right" }, { header: "Valor", align: "right" }],
            linhas: linhas.map((l) => [l.nome, l.sku, l.siteNome, D(l.estoqueFechado), D(l.estoqueAberto), l.custoMedio != null ? brl(l.custoMedio) : "—", brl(l.valorEstoque)]),
            vazio: "Sem estoque cadastrado.",
          },
        ],
      };
    }

    case "estoque-ruptura": {
      const linhas = await ruptura(siteId, policy);
      // As colunas de meta só existem se a empresa usa meta.
      const colunas = [
        { header: "Produto" },
        { header: "SKU" },
        { header: "Site" },
        { header: "Saldo", align: "right" as const },
        ...(policy.usaMinimo ? [{ header: "Mínimo", align: "right" as const }] : []),
        ...(policy.usaIdeal ? [{ header: "Ideal", align: "right" as const }] : []),
        ...(policy.usaGiro ? [] : [{ header: "Comprar", align: "right" as const }]),
      ];
      return {
        kpis: [
          { label: policy.usaGiro ? "Produtos sem estoque" : "Produtos em ruptura", valor: String(linhas.length) },
        ],
        secoes: [
          {
            titulo: policy.usaGiro ? "Produtos sem estoque" : "Ruptura e reposição sugerida",
            subtitulo: "Saldo ao vivo no momento da emissão",
            colunas,
            linhas: linhas.map((l) => [
              l.nome,
              l.sku,
              l.siteNome,
              D(l.estoqueFechado),
              ...(policy.usaMinimo ? [D(l.estoqueMinimo)] : []),
              ...(policy.usaIdeal ? [D(l.estoqueIdeal)] : []),
              ...(policy.usaGiro ? [] : [D(l.deficit)]),
            ]),
            vazio: policy.usaGiro
              ? "Nenhum produto zerado. Estoque saudável."
              : "Nenhum produto abaixo do mínimo. Estoque saudável.",
          },
        ],
      };
    }

    case "compras": {
      const [porProduto, porFornecedor] = await Promise.all([
        comprasPorProduto(range, siteId),
        comprasPorFornecedor(range, siteId),
      ]);
      return {
        kpis: [
          { label: "Total comprado", valor: brl(porProduto.reduce((s, p) => s + p.total, 0)) },
          { label: "Produtos", valor: String(porProduto.length) },
          { label: "Fornecedores", valor: String(porFornecedor.length) },
        ],
        secoes: [
          {
            titulo: "Total por fornecedor",
            colunas: [{ header: "Fornecedor" }, { header: "Notas", align: "right" }, { header: "Total", align: "right" }],
            linhas: porFornecedor.map((f) => [f.supplierNome, String(f.numNotas), brl(f.total)]),
            vazio: "Nenhuma compra no período.",
          },
          {
            titulo: "Entradas por produto",
            colunas: [{ header: "Produto" }, { header: "SKU" }, { header: "Qtd", align: "right" }, { header: "Custo médio", align: "right" }, { header: "Total", align: "right" }],
            linhas: porProduto.map((p) => [p.nome, p.sku, D(p.quantidade), brl(p.custoMedioCompra), brl(p.total)]),
            vazio: "Nenhuma compra no período.",
          },
        ],
      };
    }
  }
}
