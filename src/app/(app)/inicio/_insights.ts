import {
  AlertTriangle,
  PackageX,
  Clock,
  Truck,
  TrendingUp,
  TrendingDown,
  ShoppingCart,
  CalendarDays,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { pct as fmtPct, type Variacao } from "@/lib/periodo";
import { brl } from "@/lib/utils";
import type { ResumoVendas, RupturaRow, MixPagamento, PontoFinanceiro, CategoriaAgg } from "../relatorios/_data";
import type { PedidoAndamento, ProdutoCrescimento, OportunidadeFornecedor, PrevisaoRuptura } from "./_data";

/**
 * Motor de insights do Centro de Operações Inteligente. 100% determinístico —
 * regras sobre os números já carregados, sem chamar LLM (a única chamada de
 * IA do dashboard é opcional e reescreve o `resumoAssistente`, ver actions.ts).
 * Nunca inventa dado: todo texto cita um número que já veio do banco.
 *
 * Aprendizado (dismissedHoje/ignoreRatio): vem de InsightFeedback, populado
 * quando o operador clica "Ignorar" ou num CTA. Regras de `escopo: "assistente"`
 * (ruptura, pedido de hoje, faturamento) NUNCA são demovidas por esse histórico
 * — são risco operacional, não "ruído" — só o `escopo: "cards"` é afetado.
 */

export type Tom = "alerta" | "oportunidade" | "info" | "sucesso";

export type IconeInsight =
  | "ruptura"
  | "ruptura-produto"
  | "previsao"
  | "pedido"
  | "alta"
  | "queda"
  | "compra"
  | "calendario"
  | "carteira";

/** Chave → componente, resolvido só onde é renderizado (evita passar função pela fronteira RSC→client). */
export const ICON_MAP: Record<IconeInsight, LucideIcon> = {
  ruptura: PackageX,
  "ruptura-produto": AlertTriangle,
  previsao: Clock,
  pedido: Truck,
  alta: TrendingUp,
  queda: TrendingDown,
  compra: ShoppingCart,
  calendario: CalendarDays,
  carteira: Wallet,
};

export type Insight = {
  id: string;
  tom: Tom;
  icone: IconeInsight;
  titulo: string;
  corpo: string;
  cta?: { label: string; href: string };
  /** "assistente" = digest no painel do topo. "cards" = card próprio na seção de Insights. */
  escopo: "assistente" | "cards";
  prioridade: number; // menor = mais importante (ordena o painel do assistente)
  /** Magnitude em R$ do que está em jogo — reordena os cards por impacto real, não só por regra. */
  impacto?: number;
};

export type InsightsInput = {
  resumo: ResumoVendas;
  resumoPrev: ResumoVendas;
  rupturaRows: RupturaRow[];
  previsaoRuptura: PrevisaoRuptura[];
  pedidos: PedidoAndamento[];
  crescimento: ProdutoCrescimento[];
  mix: MixPagamento[];
  mixPrev: MixPagamento[];
  serie: PontoFinanceiro[];
  /** Baseline de dias anteriores ao período de comparação — mede desvio real, não limiar fixo. */
  historico: PontoFinanceiro[];
  categorias: CategoriaAgg[];
  categoriasPrev: CategoriaAgg[];
  oportunidades: OportunidadeFornecedor[];
  /** Aprendizado a partir do feedback do operador (InsightFeedback). */
  dismissedHoje: Set<string>;
  ignoreRatio: Map<string, number>;
};

const DIAS_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const DEMOTE_IGNORE_RATIO = 0.7;

export function saudacao(agora = new Date()): string {
  const h = agora.getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

export function buildInsights(input: InsightsInput): Insight[] {
  const insights: Insight[] = [];

  // 1. Ruptura — alerta no assistente.
  if (input.rupturaRows.length > 0) {
    const top = input.rupturaRows[0];
    insights.push({
      id: "ruptura",
      tom: "alerta",
      icone: "ruptura",
      titulo: `${input.rupturaRows.length} produto${input.rupturaRows.length > 1 ? "s" : ""} em ruptura`,
      corpo:
        input.rupturaRows.length === 1
          ? `${top.nome} está abaixo do estoque mínimo.`
          : `${top.nome} e mais ${input.rupturaRows.length - 1} produto${input.rupturaRows.length > 2 ? "s" : ""} abaixo do estoque mínimo.`,
      cta: { label: "Revisar estoque", href: "/estoque?filtro=baixoMinimo"},
      escopo: "assistente",
      prioridade: 1,
    });

    if (top.estoqueFechado > 0) {
      insights.push({
        id: "ruptura-produto",
        tom: "alerta",
        icone: "ruptura-produto",
        titulo: `Restam apenas ${top.estoqueFechado.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} unidades de ${top.nome}`,
        corpo: "Reposição recomendada para hoje.",
        cta: { label: "Ver estoque", href: "/estoque?filtro=baixoMinimo"},
        escopo: "cards",
        prioridade: 5,
      });
    }
  }

  // 1b. Previsão de ruptura — ainda acima do mínimo, mas o ritmo de venda esgota em poucos dias.
  const previsao = input.previsaoRuptura[0];
  if (previsao) {
    insights.push({
      id: "previsao-ruptura",
      tom: "alerta",
      icone: "previsao",
      titulo: `${previsao.nome} esgota em ${previsao.coberturaDias} dia${previsao.coberturaDias === 1 ? "" : "s"}`,
      corpo: `No ritmo atual de venda, o estoque (${previsao.estoque.toLocaleString("pt-BR")} un) não chega na próxima semana.`,
      cta: { label: "Ver reposição", href: "/compras/reposicao-inteligente" },
      escopo: "cards",
      prioridade: 4,
    });
  }

  // 2. Pedido de compra previsto para hoje — info no assistente.
  const pedidoHoje = input.pedidos.find((p) => p.previsaoHoje);
  if (pedidoHoje) {
    insights.push({
      id: "pedido-hoje",
      tom: "info",
      icone: "pedido",
      titulo: "Pedido previsto para entrega hoje",
      corpo: `${pedidoHoje.numero} · ${pedidoHoje.supplierNome} · ${brl(pedidoHoje.valorTotal)}.`,
      cta: { label: "Ver pedido", href: "/compras" },
      escopo: "assistente",
      prioridade: 2,
    });
  }

  // 3. Faturamento x período anterior — anomalia por desvio-padrão do histórico
  // (fallback: limiar fixo de 5% quando não há histórico suficiente).
  const diasPeriodo = Math.max(1, input.serie.length);
  const deltaFat = deltaSignificativo(
    input.resumo.faturamento,
    input.resumoPrev.faturamento,
    input.historico.map((h) => h.receita),
    input.resumo.faturamento / diasPeriodo,
  );
  if (deltaFat) {
    const caiu = deltaFat.dir === "down";
    let corpo = `Em relação ao período anterior (${brl(input.resumoPrev.faturamento)} → ${brl(input.resumo.faturamento)}).`;
    if (caiu) {
      const categoria = categoriaQueMaisCaiu(input.categorias, input.categoriasPrev);
      if (categoria) corpo += ` Categoria "${categoria.categoria}" puxou a queda (${brl(Math.abs(categoria.delta))}).`;
    }
    insights.push({
      id: "faturamento",
      tom: caiu ? "alerta" : "sucesso",
      icone: caiu ? "queda" : "alta",
      titulo: `Faturamento ${caiu ? "caiu" : "subiu"} ${fmtPct(Math.abs(deltaFat.pct ?? 0), 0)}`,
      corpo,
      cta: { label: "Ver relatório", href: "/relatorios/vendas" },
      escopo: "assistente",
      prioridade: 3,
      impacto: Math.abs(input.resumo.faturamento - input.resumoPrev.faturamento),
    });
  }

  // 4. Produto com maior crescimento de receita.
  const maiorCrescimento = [...input.crescimento]
    .filter((p) => p.crescimento.dir === "up" && p.crescimento.pct != null && p.receita > 0)
    .sort((a, b) => (b.crescimento.pct ?? 0) - (a.crescimento.pct ?? 0))[0];
  if (maiorCrescimento) {
    insights.push({
      id: "produto-crescimento",
      tom: "sucesso",
      icone: "alta",
      titulo: `${maiorCrescimento.nome} cresceu ${fmtPct(maiorCrescimento.crescimento.pct ?? 0, 0)}`,
      corpo: "Foi o produto com maior crescimento neste período.",
      cta: { label: "Ver produto", href: "/relatorios/vendas" },
      escopo: "cards",
      prioridade: 6,
      impacto: maiorCrescimento.receita,
    });
  }

  // 5. Oportunidade de pedido mínimo por fornecedor.
  const oportunidade = input.oportunidades[0];
  if (oportunidade) {
    insights.push({
      id: "pedido-minimo",
      tom: "oportunidade",
      icone: "compra",
      titulo: `Perto do pedido mínimo de ${oportunidade.supplierNome}`,
      corpo: `Faltam ${brl(oportunidade.falta)} para atingir o mínimo de ${brl(oportunidade.minimo)}.`,
      cta: { label: "Criar pedido", href: "/compras" },
      escopo: "cards",
      prioridade: 7,
      impacto: oportunidade.atual,
    });
  }

  // 6. Ticket médio em queda (mesma lógica de anomalia por desvio).
  const deltaTicket = deltaSignificativo(
    input.resumo.ticket,
    input.resumoPrev.ticket,
    input.historico.map((h) => h.ticket),
    input.resumo.ticket,
  );
  if (deltaTicket && deltaTicket.dir === "down") {
    insights.push({
      id: "ticket",
      tom: "alerta",
      icone: "queda",
      titulo: `Ticket médio caiu ${fmtPct(Math.abs(deltaTicket.pct ?? 0), 0)}`,
      corpo: `De ${brl(input.resumoPrev.ticket)} para ${brl(input.resumo.ticket)} no período.`,
      cta: { label: "Ver relatório", href: "/relatorios/vendas" },
      escopo: "cards",
      prioridade: 8,
      impacto: Math.abs(input.resumo.ticket - input.resumoPrev.ticket) * input.resumo.numVendas,
    });
  }

  // 7. Concentração de vendas por dia da semana.
  const concentracao = diaComMaiorConcentracao(input.serie);
  if (concentracao) {
    insights.push({
      id: "concentracao-dia",
      tom: "info",
      icone: "calendario",
      titulo: `${capitalizar(concentracao.dia)} concentrou ${fmtPct(concentracao.pctValor, 0)} das vendas`,
      corpo: "Considere reforçar estoque e equipe nesse dia da semana.",
      escopo: "cards",
      prioridade: 9,
    });
  }

  // 8. Crescimento de fatia de um método de pagamento.
  const metodoCresceu = maiorCrescimentoMix(input.mix, input.mixPrev);
  if (metodoCresceu) {
    insights.push({
      id: "mix-pagamento",
      tom: "info",
      icone: "carteira",
      titulo: `${metodoCresceu.metodo} cresceu ${fmtPct(metodoCresceu.deltaPp, 0)} na composição`,
      corpo: "Em relação à fatia do período anterior.",
      escopo: "cards",
      prioridade: 10,
    });
  }

  // Filtra o que o operador já dispensou hoje, depois reordena.
  const restantes = insights.filter((i) => !input.dismissedHoje.has(i.id));
  return ordenar(restantes, input.ignoreRatio);
}

/** Assistente fica em ordem fixa de urgência; cards reordenam por impacto (R$) e descem se muito ignorados. */
function ordenar(insights: Insight[], ignoreRatio: Map<string, number>): Insight[] {
  const assistente = insights.filter((i) => i.escopo === "assistente").sort((a, b) => a.prioridade - b.prioridade);
  const cards = insights
    .filter((i) => i.escopo === "cards")
    .sort((a, b) => {
      const demotedA = (ignoreRatio.get(a.id) ?? 0) >= DEMOTE_IGNORE_RATIO;
      const demotedB = (ignoreRatio.get(b.id) ?? 0) >= DEMOTE_IGNORE_RATIO;
      if (demotedA !== demotedB) return demotedA ? 1 : -1;
      const impA = a.impacto ?? 0;
      const impB = b.impacto ?? 0;
      if (impA !== impB) return impB - impA;
      return a.prioridade - b.prioridade;
    });
  return [...assistente, ...cards];
}

/** Texto de regra pro Painel do Assistente — some antes de qualquer chamada de IA. */
export function resumoAssistente(insights: Insight[]): string {
  if (insights.length === 0) return "Tudo certo. Nenhuma ação importante para hoje.";
  const top = insights.slice(0, 3);
  const bullets = top.map((i) => `• ${i.titulo}.`).join("\n");
  return `Analisei sua operação. Hoje encontrei ${insights.length} ${insights.length === 1 ? "ponto importante" : "pontos importantes"}.\n\n${bullets}`;
}

// ── Helpers ───────────────────────────────────────────────────

const LIMIAR_PCT = 5;
const Z_LIMIAR = 1.5;
const HISTORICO_MIN_DIAS = 10;

function variacaoSignificativa(atual: number, anterior: number): Variacao | null {
  if (anterior === 0) return null;
  const p = ((atual - anterior) / Math.abs(anterior)) * 100;
  if (Math.abs(p) < LIMIAR_PCT) return null;
  return { pct: Math.round(p * 10) / 10, dir: p > 0 ? "up" : "down" };
}

/**
 * Anomalia relativa ao histórico: com dados suficientes, compara a média
 * atual contra a distribuição real dos últimos dias (z-score) em vez de um
 * limiar fixo — uma variação de 8% é ruído num negócio volátil e é anomalia
 * real num negócio estável. Sem histórico (tenant novo), cai no limiar fixo.
 */
function deltaSignificativo(
  atualTotal: number,
  anteriorTotal: number,
  historicoValores: number[],
  mediaAtualDiaria: number,
): Variacao | null {
  const validos = historicoValores.filter((v) => v > 0);
  if (validos.length >= HISTORICO_MIN_DIAS) {
    const media = validos.reduce((s, v) => s + v, 0) / validos.length;
    const variancia = validos.reduce((s, v) => s + (v - media) ** 2, 0) / validos.length;
    const desvio = Math.sqrt(variancia);
    if (desvio > 0) {
      const z = (mediaAtualDiaria - media) / desvio;
      if (Math.abs(z) < Z_LIMIAR) return null; // dentro da variação normal, mesmo que a % pareça grande
      const pct =
        anteriorTotal !== 0 ? Math.round(((atualTotal - anteriorTotal) / Math.abs(anteriorTotal)) * 1000) / 10 : null;
      return { pct, dir: z > 0 ? "up" : "down" };
    }
  }
  return variacaoSignificativa(atualTotal, anteriorTotal);
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function diaComMaiorConcentracao(serie: PontoFinanceiro[]): { dia: string; pctValor: number } | null {
  const total = serie.reduce((s, p) => s + p.receita, 0);
  if (total <= 0 || serie.length < 3) return null;
  const porDiaSemana = new Map<number, number>();
  for (const p of serie) {
    const [ano, mes, dia] = p.data.split("-").map(Number);
    const dow = new Date(ano, mes - 1, dia).getDay();
    porDiaSemana.set(dow, (porDiaSemana.get(dow) ?? 0) + p.receita);
  }
  let melhorDow = 0;
  let melhorValor = 0;
  for (const [dow, valor] of porDiaSemana) {
    if (valor > melhorValor) {
      melhorValor = valor;
      melhorDow = dow;
    }
  }
  const pctValor = (melhorValor / total) * 100;
  if (pctValor < 30) return null; // só vale destacar concentração real
  return { dia: DIAS_SEMANA[melhorDow], pctValor };
}

function maiorCrescimentoMix(mix: MixPagamento[], mixPrev: MixPagamento[]): { metodo: string; deltaPp: number } | null {
  const totalAtual = mix.reduce((s, m) => s + m.valor, 0);
  const totalPrev = mixPrev.reduce((s, m) => s + m.valor, 0);
  if (totalAtual <= 0 || totalPrev <= 0) return null;
  const prevShare = new Map(mixPrev.map((m) => [m.metodo, m.valor / totalPrev]));

  let melhor: { metodo: string; deltaPp: number } | null = null;
  for (const m of mix) {
    const shareAtual = m.valor / totalAtual;
    const shareAnterior = prevShare.get(m.metodo) ?? 0;
    const deltaPp = (shareAtual - shareAnterior) * 100;
    if (deltaPp >= 5 && (!melhor || deltaPp > melhor.deltaPp)) {
      melhor = { metodo: m.metodo, deltaPp: Math.round(deltaPp * 10) / 10 };
    }
  }
  return melhor;
}

/** Categoria que mais puxou a queda de faturamento — vira a explicação do "por quê". */
function categoriaQueMaisCaiu(categorias: CategoriaAgg[], categoriasPrev: CategoriaAgg[]): { categoria: string; delta: number } | null {
  if (categorias.length === 0 && categoriasPrev.length === 0) return null;
  const atualMap = new Map(categorias.map((c) => [c.categoria, c.receita]));
  const todas = new Set([...atualMap.keys(), ...categoriasPrev.map((c) => c.categoria)]);

  let pior: { categoria: string; delta: number } | null = null;
  for (const cat of todas) {
    const atual = atualMap.get(cat) ?? 0;
    const anterior = categoriasPrev.find((c) => c.categoria === cat)?.receita ?? 0;
    const delta = atual - anterior;
    if (delta < 0 && (!pior || delta < pior.delta)) pior = { categoria: cat, delta };
  }
  return pior;
}
