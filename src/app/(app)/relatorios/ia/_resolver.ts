import "server-only";
import { brl } from "@/lib/utils";
import { pct } from "@/lib/periodo";
import {
  rankingProdutos,
  vendasPorCategoria,
  mixPagamento,
  perdas,
  comprasPorProduto,
  posicaoEstoque,
  fechamentosCaixa,
  curvaABC,
  type Range,
  type ProdutoVendaAgg,
} from "../_data";
import type { Consulta } from "./_schema";

/**
 * Executa a Consulta validada. Cada `fonte` mapeia para uma função de dados já
 * existente (todas passam por `db` → tenant injetado). Filtros/ordenção/limite
 * são aplicados em memória sobre o resultado agregado — nunca em SQL cru. O
 * retorno já vem formatado em pt-BR (string).
 */

const D = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

export type Resolvido = {
  colunas: { header: string; align?: "right" }[];
  linhas: string[][];
  /** Linhas cruas (números) para a IA resumir — cap aplicado antes de enviar. */
  brutas: Record<string, unknown>[];
  totalLinhas: number;
  descricaoFonte: string;
};

function aplicaFiltrosProduto(rows: ProdutoVendaAgg[], c: Consulta): ProdutoVendaAgg[] {
  const f = c.filtros;
  let out = rows;
  if (f?.categoria) {
    const alvo = f.categoria.toLowerCase();
    out = out.filter((r) => (r.categoria ?? "").toLowerCase().includes(alvo));
  }
  if (f?.margemPctMin != null) out = out.filter((r) => r.margemPct >= f.margemPctMin!);
  if (f?.margemPctMax != null) out = out.filter((r) => r.margemPct <= f.margemPctMax!);
  if (f?.receitaMin != null) out = out.filter((r) => r.receita >= f.receitaMin!);
  if (f?.quantidadeMin != null) out = out.filter((r) => r.quantidade >= f.quantidadeMin!);
  return out;
}

function ordena<T extends Record<string, unknown>>(rows: T[], campo: string | undefined, ordem: "asc" | "desc"): T[] {
  if (!campo) return rows;
  const dir = ordem === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = a[campo];
    const vb = b[campo];
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
    return String(va ?? "").localeCompare(String(vb ?? ""), "pt-BR") * dir;
  });
}

export async function resolverConsulta(c: Consulta, range: Range, siteId: string | null): Promise<Resolvido> {
  switch (c.fonte) {
    case "produtos": {
      const rows = ordena(aplicaFiltrosProduto(await rankingProdutos(range, siteId), c), c.ordenarPor ?? "receita", c.ordem).slice(0, c.limite);
      return {
        colunas: [{ header: "Produto" }, { header: "SKU" }, { header: "Categoria" }, { header: "Qtd", align: "right" }, { header: "Receita", align: "right" }, { header: "CMV", align: "right" }, { header: "Margem", align: "right" }, { header: "Margem %", align: "right" }],
        linhas: rows.map((r) => [r.nome, r.sku, r.categoria ?? "—", D(r.quantidade), brl(r.receita), brl(r.custo), brl(r.margem), pct(r.margemPct, 1)]),
        brutas: rows.map((r) => ({ produto: r.nome, categoria: r.categoria, quantidade: r.quantidade, receita: r.receita, cmv: r.custo, margem: r.margem, margemPct: Math.round(r.margemPct) })),
        totalLinhas: rows.length,
        descricaoFonte: "produtos vendidos",
      };
    }
    case "categorias": {
      const rows = ordena(await vendasPorCategoria(range, siteId), c.ordenarPor === "quantidade" ? "quantidade" : "receita", c.ordem).slice(0, c.limite);
      return {
        colunas: [{ header: "Categoria" }, { header: "Qtd", align: "right" }, { header: "Receita", align: "right" }],
        linhas: rows.map((r) => [r.categoria, D(r.quantidade), brl(r.receita)]),
        brutas: rows.map((r) => ({ categoria: r.categoria, quantidade: r.quantidade, receita: r.receita })),
        totalLinhas: rows.length,
        descricaoFonte: "vendas por categoria",
      };
    }
    case "pagamentos": {
      const rows = (await mixPagamento(range, siteId)).slice(0, c.limite);
      return {
        colunas: [{ header: "Método" }, { header: "Valor", align: "right" }],
        linhas: rows.map((r) => [r.metodo, brl(r.valor)]),
        brutas: rows.map((r) => ({ metodo: r.metodo, valor: r.valor })),
        totalLinhas: rows.length,
        descricaoFonte: "mix de pagamento",
      };
    }
    case "perdas": {
      const r = await perdas(range, siteId);
      const rows = ordena(r.itens, c.ordenarPor === "quantidade" ? "quantidade" : "custo", c.ordem).slice(0, c.limite);
      return {
        colunas: [{ header: "Produto" }, { header: "SKU" }, { header: "Qtd", align: "right" }, { header: "Custo", align: "right" }],
        linhas: rows.map((p) => [p.nome, p.sku, D(p.quantidade), brl(p.custo)]),
        brutas: rows.map((p) => ({ produto: p.nome, quantidade: p.quantidade, custo: p.custo })),
        totalLinhas: rows.length,
        descricaoFonte: "perdas por produto",
      };
    }
    case "compras": {
      const rows = ordena(await comprasPorProduto(range, siteId), c.ordenarPor === "quantidade" ? "quantidade" : "total", c.ordem).slice(0, c.limite);
      return {
        colunas: [{ header: "Produto" }, { header: "SKU" }, { header: "Qtd", align: "right" }, { header: "Custo médio", align: "right" }, { header: "Total", align: "right" }],
        linhas: rows.map((p) => [p.nome, p.sku, D(p.quantidade), brl(p.custoMedioCompra), brl(p.total)]),
        brutas: rows.map((p) => ({ produto: p.nome, quantidade: p.quantidade, total: p.total })),
        totalLinhas: rows.length,
        descricaoFonte: "compras por produto",
      };
    }
    case "estoque": {
      const all = await posicaoEstoque(siteId);
      const rows = ordena(all, c.ordenarPor === "quantidade" ? "estoqueFechado" : "valorEstoque", c.ordem).slice(0, c.limite);
      return {
        colunas: [{ header: "Produto" }, { header: "SKU" }, { header: "Site" }, { header: "Fechado", align: "right" }, { header: "Valor", align: "right" }],
        linhas: rows.map((s) => [s.nome, s.sku, s.siteNome, D(s.estoqueFechado), brl(s.valorEstoque)]),
        brutas: rows.map((s) => ({ produto: s.nome, saldo: s.estoqueFechado, valor: s.valorEstoque, abaixoMinimo: s.abaixoMinimo })),
        totalLinhas: rows.length,
        descricaoFonte: "posição de estoque ao vivo",
      };
    }
    case "caixa": {
      const rows = (await fechamentosCaixa(range, siteId)).slice(0, c.limite);
      return {
        colunas: [{ header: "Fechado em" }, { header: "Caixa" }, { header: "Esperado", align: "right" }, { header: "Contado", align: "right" }, { header: "Quebra", align: "right" }],
        linhas: rows.map((f) => [f.fechadaEm ? f.fechadaEm.toLocaleDateString("pt-BR") : "—", f.siteNome, brl(f.esperado), f.contado != null ? brl(f.contado) : "—", f.quebra != null ? brl(f.quebra) : "—"]),
        brutas: rows.map((f) => ({ data: f.fechadaEm?.toLocaleDateString("pt-BR"), esperado: f.esperado, contado: f.contado, quebra: f.quebra })),
        totalLinhas: rows.length,
        descricaoFonte: "fechamentos de caixa",
      };
    }
    case "abc": {
      const rows = (await curvaABC(range, siteId)).slice(0, c.limite);
      return {
        colunas: [{ header: "Classe" }, { header: "Produto" }, { header: "SKU" }, { header: "Receita", align: "right" }, { header: "% acum.", align: "right" }],
        linhas: rows.map((p) => [p.classe, p.nome, p.sku, brl(p.receita), pct(p.acumuladoPct, 1)]),
        brutas: rows.map((p) => ({ classe: p.classe, produto: p.nome, receita: p.receita, acumuladoPct: Math.round(p.acumuladoPct) })),
        totalLinhas: rows.length,
        descricaoFonte: "curva ABC",
      };
    }
  }
}
