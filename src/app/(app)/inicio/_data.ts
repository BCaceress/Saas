import "server-only";
import { db } from "@/lib/prisma";
import { variacao, type Variacao } from "@/lib/periodo";
import {
  rankingProdutos,
  serieFinanceiraDiaria,
  vendasPorCategoria,
  type Range,
  type ProdutoVendaAgg,
  type PontoFinanceiro,
} from "../relatorios/_data";
import { loadSugestoesReposicao } from "../compras/_data";

const DIA = 86_400_000;

/**
 * Camada de dados exclusiva do /inicio (Centro de Operações Inteligente).
 * Tudo aqui é composição sobre leituras já existentes em relatorios/_data.ts
 * e compras/_data.ts — nenhuma tabela nova, nenhuma query duplicada.
 */

const n = (v: unknown): number => (v == null ? 0 : Number(v));

type SiteFilter = string | null;

// ── Pedidos de compra em andamento ──────────────────────────

export type PedidoAndamento = {
  id: string;
  numero: string;
  status: string;
  supplierNome: string;
  previsaoEntrega: Date | null;
  previsaoHoje: boolean;
  valorTotal: number;
};

const STATUS_EM_ANDAMENTO = ["ENVIADO", "AGUARDANDO", "EM_TRANSITO", "RECEBIDO_PARCIAL"] as const;

export async function pedidosEmAndamento(siteId: SiteFilter): Promise<PedidoAndamento[]> {
  const hoje0 = new Date();
  hoje0.setHours(0, 0, 0, 0);
  const amanha0 = new Date(hoje0.getTime() + 86400000);

  const pedidos = await db.purchaseOrder.findMany({
    where: { status: { in: [...STATUS_EM_ANDAMENTO] }, ...(siteId ? { siteId } : {}) },
    select: {
      id: true,
      numero: true,
      status: true,
      previsaoEntrega: true,
      valorTotal: true,
      supplier: { select: { razaoSocial: true, nomeFantasia: true } },
    },
    orderBy: { previsaoEntrega: "asc" },
  });

  return pedidos.map((p) => ({
    id: p.id,
    numero: p.numero,
    status: p.status,
    supplierNome: p.supplier.nomeFantasia ?? p.supplier.razaoSocial,
    previsaoEntrega: p.previsaoEntrega,
    previsaoHoje: !!p.previsaoEntrega && p.previsaoEntrega >= hoje0 && p.previsaoEntrega < amanha0,
    valorTotal: n(p.valorTotal),
  }));
}

// ── Crescimento de produtos (período atual x anterior) ──────

export type ProdutoCrescimento = ProdutoVendaAgg & { crescimento: Variacao };

export async function crescimentoProdutos(
  range: Range,
  prevRange: Range,
  siteId: SiteFilter,
): Promise<ProdutoCrescimento[]> {
  const [atual, anterior] = await Promise.all([
    rankingProdutos(range, siteId),
    rankingProdutos(prevRange, siteId),
  ]);
  const prevMap = new Map(anterior.map((p) => [p.productId, p.receita]));
  return atual.map((p) => ({ ...p, crescimento: variacao(p.receita, prevMap.get(p.productId) ?? 0) }));
}

// ── Reposição: oportunidade de pedido mínimo + previsão de ruptura ─
// Uma só chamada a loadSugestoesReposicao (query pesada) alimenta os dois
// insights — evita rodar a mesma agregação duas vezes por load do dashboard.

export type OportunidadeFornecedor = {
  supplierNome: string;
  atual: number;
  minimo: number;
  falta: number;
};

export type PrevisaoRuptura = {
  productId: string;
  nome: string;
  sku: string;
  coberturaDias: number;
  estoque: number;
};

export type AnaliseReposicao = {
  oportunidades: OportunidadeFornecedor[];
  previsaoRuptura: PrevisaoRuptura[];
};

const COBERTURA_CRITICA_DIAS = 3;

export async function analiseReposicao(siteId: SiteFilter): Promise<AnaliseReposicao> {
  const grupos = await loadSugestoesReposicao(siteId);

  // Previsão: item ainda acima do mínimo (não é "ruptura" hoje) mas o ritmo de
  // venda esgota o estoque em poucos dias — alerta antecipado, não reativo.
  const previsaoRuptura: PrevisaoRuptura[] = [];
  for (const g of grupos) {
    for (const item of g.itens) {
      if (
        item.coberturaDias != null &&
        item.coberturaDias <= COBERTURA_CRITICA_DIAS &&
        item.estoque > item.estoqueMinimo
      ) {
        previsaoRuptura.push({
          productId: item.productId,
          nome: item.nome,
          sku: item.sku,
          coberturaDias: item.coberturaDias,
          estoque: item.estoque,
        });
      }
    }
  }
  previsaoRuptura.sort((a, b) => a.coberturaDias - b.coberturaDias);

  // Oportunidade: grupos de reposição sugerida cujo total já cobre metade do
  // pedido mínimo do fornecedor.
  const candidatos = grupos.filter((g) => g.supplierId && g.itens.some((i) => i.qtdSugerida > 0));
  const oportunidades: OportunidadeFornecedor[] = [];
  if (candidatos.length > 0) {
    const supplierIds = candidatos.map((g) => g.supplierId!);
    const suppliers = await db.supplier.findMany({
      where: { id: { in: supplierIds }, pedidoMinimo: { not: null, gt: 0 } },
      select: { id: true, pedidoMinimo: true },
    });
    const minimoMap = new Map(suppliers.map((s) => [s.id, n(s.pedidoMinimo)]));

    for (const g of candidatos) {
      const minimo = g.supplierId ? minimoMap.get(g.supplierId) : undefined;
      if (!minimo) continue;
      const atual = g.itens.reduce((s, i) => s + i.qtdSugerida * (i.custoUnitCompra ?? 0), 0);
      if (atual > 0 && atual < minimo && atual >= minimo * 0.5) {
        oportunidades.push({
          supplierNome: g.supplierNome,
          atual: Math.round(atual * 100) / 100,
          minimo,
          falta: Math.round((minimo - atual) * 100) / 100,
        });
      }
    }
    oportunidades.sort((a, b) => a.falta - b.falta);
  }

  return { oportunidades, previsaoRuptura };
}

// ── Ritmo de criação de pedidos (sparkline + delta do KPI "Pedidos") ─

export type RitmoPedidos = { atual: number; anterior: number; porDia: number[] };

/** Contagem de PurchaseOrder criados por dia, período atual x anterior. */
export async function ritmoPedidos(range: Range, prevRange: Range, siteId: SiteFilter): Promise<RitmoPedidos> {
  const pedidos = await db.purchaseOrder.findMany({
    where: { createdAt: { gte: prevRange.inicio, lt: range.fim }, ...(siteId ? { siteId } : {}) },
    select: { createdAt: true },
  });

  const chaveDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const porDiaMap = new Map<string, number>();
  for (let d = new Date(range.inicio); d < range.fim; d = new Date(d.getTime() + 86400000)) {
    porDiaMap.set(chaveDia(d), 0);
  }

  let atual = 0;
  let anterior = 0;
  for (const p of pedidos) {
    if (p.createdAt >= range.inicio && p.createdAt < range.fim) {
      atual += 1;
      const k = chaveDia(p.createdAt);
      if (porDiaMap.has(k)) porDiaMap.set(k, (porDiaMap.get(k) ?? 0) + 1);
    } else if (p.createdAt >= prevRange.inicio && p.createdAt < prevRange.fim) {
      anterior += 1;
    }
  }

  return { atual, anterior, porDia: [...porDiaMap.values()] };
}

// ── Total de itens monitorados em estoque (denominador do hint de ruptura) ─

export async function totalItensEstoque(siteId: SiteFilter): Promise<number> {
  return db.stock.count({ where: siteId ? { siteId } : {} });
}

// ── Histórico diário (baseline p/ detectar anomalia por desvio-padrão) ─

/** N dias imediatamente anteriores ao período de comparação — a "normalidade" contra a qual medir. */
export async function historicoDiario(prevRange: Range, siteId: SiteFilter, dias = 28): Promise<PontoFinanceiro[]> {
  const fim = prevRange.inicio;
  const inicio = new Date(fim.getTime() - dias * 86400000);
  return serieFinanceiraDiaria({ inicio, fim }, siteId);
}

// ── Feedback de insights (aprendizado de priorização) ───────

export type FeedbackInsights = {
  /** Regras ignoradas HOJE — somem da tela até amanhã (persistência do "Ignorar"). */
  dismissedHoje: Set<string>;
  /** ignorados / (ignorados + clicados) nos últimos 30 dias, só quando houver ≥3 amostras. */
  ignoreRatio: Map<string, number>;
};

export async function feedbackInsights(): Promise<FeedbackInsights> {
  const hoje0 = new Date();
  hoje0.setHours(0, 0, 0, 0);
  const d30 = new Date(Date.now() - 30 * 86400000);

  const linhas = await db.insightFeedback.findMany({
    where: { createdAt: { gte: d30 } },
    select: { insightId: true, acao: true, createdAt: true },
  });

  const dismissedHoje = new Set<string>();
  const contagem = new Map<string, { ignorados: number; clicados: number }>();
  for (const l of linhas) {
    const c = contagem.get(l.insightId) ?? { ignorados: 0, clicados: 0 };
    if (l.acao === "IGNORADO") {
      c.ignorados += 1;
      if (l.createdAt >= hoje0) dismissedHoje.add(l.insightId);
    } else {
      c.clicados += 1;
    }
    contagem.set(l.insightId, c);
  }

  const ignoreRatio = new Map<string, number>();
  for (const [id, c] of contagem) {
    const total = c.ignorados + c.clicados;
    if (total >= 3) ignoreRatio.set(id, c.ignorados / total);
  }

  return { dismissedHoje, ignoreRatio };
}

// ── Produtos sem giro (dead stock) ──────────────────────────

export type ProdutoSemGiro = {
  productId: string;
  nome: string;
  sku: string;
  imagemUrl: string | null;
  diasParado: number;
  saldo: number;
  valorParado: number;
};

/**
 * Produtos com saldo > 0 mas sem venda/movimentação há mais de `paradoDias`
 * (mesmo limiar do alerta "parado" do sino, `tenant.produtoParadoDias`).
 * Produto sem NENHUMA movimentação ainda não entra aqui — é "novo", não "parado".
 */
export async function produtosSemGiro(siteId: SiteFilter, paradoDias: number, limite = 8): Promise<ProdutoSemGiro[]> {
  const [produtos, movs] = await Promise.all([
    db.product.findMany({
      where: { ativo: true, controlaEstoque: true },
      select: {
        id: true,
        nome: true,
        sku: true,
        imagemUrl: true,
        custo: true,
        custoMedio: true,
        stocks: { where: siteId ? { siteId } : {}, select: { estoqueFechado: true } },
      },
    }),
    db.stockMovement.groupBy({ by: ["productId"], _max: { createdAt: true } }),
  ]);

  const ultimoMov = new Map<string, number>();
  for (const m of movs) {
    if (m._max.createdAt) ultimoMov.set(m.productId, new Date(m._max.createdAt).getTime());
  }

  const agora = Date.now();
  const rows: ProdutoSemGiro[] = [];
  for (const p of produtos) {
    const saldo = p.stocks.reduce((s, e) => s + n(e.estoqueFechado), 0);
    if (saldo <= 0) continue;
    const ultimo = ultimoMov.get(p.id);
    if (ultimo == null) continue;
    const diasParado = Math.floor((agora - ultimo) / DIA);
    if (diasParado < paradoDias) continue;
    const custo = n(p.custoMedio) || n(p.custo);
    rows.push({
      productId: p.id,
      nome: p.nome,
      sku: p.sku,
      imagemUrl: p.imagemUrl,
      diasParado,
      saldo,
      valorParado: Math.round(saldo * custo * 100) / 100,
    });
  }

  return rows.sort((a, b) => b.valorParado - a.valorParado).slice(0, limite);
}

// ── Categorias: faturamento, lucro, participação e tendência ─

export type CategoriaComparativo = {
  categoria: string;
  receita: number;
  margem: number;
  margemPct: number;
  participacaoPct: number;
  tendencia: Variacao;
};

export async function categoriasComparativo(range: Range, prevRange: Range, siteId: SiteFilter): Promise<CategoriaComparativo[]> {
  const [atual, anterior] = await Promise.all([vendasPorCategoria(range, siteId), vendasPorCategoria(prevRange, siteId)]);
  const totalAtual = atual.reduce((s, c) => s + c.receita, 0);
  const prevMap = new Map(anterior.map((c) => [c.categoria, c.receita]));

  return atual
    .map((c) => ({
      categoria: c.categoria,
      receita: c.receita,
      margem: c.margem,
      margemPct: c.receita > 0 ? (c.margem / c.receita) * 100 : 0,
      participacaoPct: totalAtual > 0 ? (c.receita / totalAtual) * 100 : 0,
      tendencia: variacao(c.receita, prevMap.get(c.categoria) ?? 0),
    }))
    .sort((a, b) => b.receita - a.receita);
}
