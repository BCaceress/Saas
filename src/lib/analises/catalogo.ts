import { podeEmAlguma, type Acesso, type Permissao } from "@/lib/permissoes";
import type { FatoId } from "./schema";

/**
 * Catálogo de análises — o que existe para perguntar.
 *
 * Fonte única de verdade de fatos, dimensões e métricas. Alimenta ao mesmo
 * tempo o motor (executa), a tela (monta os seletores), o CSV/PDF (cabeçalhos)
 * e o prompt da IA (que é GERADO daqui, nunca escrito à mão — dimensão nova
 * entra no prompt sozinha).
 */

export type Formato = "moeda" | "numero" | "inteiro" | "percentual" | "texto";

export type DimensaoDef = {
  id: string;
  label: string;
  /** Frase curta — vai para o seletor e para o prompt da IA. */
  descricao: string;
  /**
   * Dimensão de tempo: obedece `granularidade` e habilita gráfico de linha.
   * Só pode haver uma por fato.
   */
  temporal?: boolean;
};

/**
 * `soma`     — campo numérico do fato, somado dentro do grupo.
 * `distinto` — contagem de valores distintos de uma chave (ex.: nº de vendas
 *              no grão de item, que não pode ser somado sem contar duplicado).
 * `derivada` — calculada DEPOIS da agregação, a partir das outras (razões como
 *              ticket e margem % não podem ser somadas linha a linha).
 */
export type MetricaDef = {
  id: string;
  label: string;
  descricao: string;
  formato: Formato;
  /** Sem ela, a métrica é cortada da consulta pelo motor. */
  permissao?: Permissao;
} & (
  | { tipo: "soma"; campo: string }
  | { tipo: "distinto"; chave: string }
  | { tipo: "derivada"; requer: string[]; calcular: (v: Record<string, number>) => number }
);

export type FatoDef = {
  id: FatoId;
  label: string;
  descricao: string;
  /** false = retrato ao vivo (posição de estoque), o período não se aplica. */
  usaPeriodo: boolean;
  dimensoes: DimensaoDef[];
  metricas: MetricaDef[];
  /** Consulta inicial quando o operador escolhe o fato sem dizer mais nada. */
  padrao: { dimensoes: string[]; metricas: string[] };
};

// ── venda-item ──────────────────────────────────────────────

const VENDA_ITEM: FatoDef = {
  id: "venda-item",
  label: "Vendas",
  descricao:
    "Cada item vendido numa venda paga. Base de faturamento, margem, ticket e ranking de produtos.",
  usaPeriodo: true,
  dimensoes: [
    { id: "produto", label: "Produto", descricao: "Nome do produto vendido." },
    { id: "sku", label: "SKU", descricao: "Código interno do produto." },
    { id: "categoria", label: "Categoria", descricao: "Categoria do produto." },
    { id: "subcategoria", label: "Subcategoria", descricao: "Subcategoria do produto." },
    { id: "marca", label: "Marca", descricao: "Marca do produto." },
    {
      id: "fornecedor",
      label: "Fornecedor",
      descricao: "Fornecedor principal cadastrado para o produto.",
    },
    { id: "site", label: "Loja", descricao: "Loja ou ponto onde a venda aconteceu." },
    { id: "operador", label: "Operador", descricao: "Quem registrou a venda no PDV." },
    { id: "cliente", label: "Cliente", descricao: "Cliente identificado na venda." },
    { id: "origem", label: "Canal", descricao: "PDV, autoatendimento ou app." },
    {
      id: "pagamento",
      label: "Forma de pagamento",
      descricao: "Método do maior pagamento da venda (venda dividida conta pelo principal).",
    },
    {
      id: "tempo",
      label: "Período",
      descricao: "Linha do tempo da venda — obedece a granularidade escolhida.",
      temporal: true,
    },
    { id: "diaSemana", label: "Dia da semana", descricao: "Segunda a domingo." },
  ],
  metricas: [
    {
      id: "receita",
      label: "Receita",
      descricao: "Total vendido, já com desconto aplicado.",
      formato: "moeda",
      tipo: "soma",
      campo: "receita",
    },
    {
      id: "quantidade",
      label: "Quantidade",
      descricao: "Unidades vendidas.",
      formato: "numero",
      tipo: "soma",
      campo: "quantidade",
    },
    {
      id: "desconto",
      label: "Desconto",
      descricao: "Total concedido em desconto.",
      formato: "moeda",
      tipo: "soma",
      campo: "desconto",
    },
    {
      id: "numVendas",
      label: "Vendas",
      descricao: "Número de vendas distintas.",
      formato: "inteiro",
      tipo: "distinto",
      chave: "venda",
    },
    {
      id: "ticket",
      label: "Ticket médio",
      descricao: "Receita dividida pelo número de vendas.",
      formato: "moeda",
      tipo: "derivada",
      requer: ["receita", "numVendas"],
      calcular: (v) => (v.numVendas > 0 ? v.receita / v.numVendas : 0),
    },
    {
      id: "precoMedio",
      label: "Preço médio",
      descricao: "Receita dividida pela quantidade vendida.",
      formato: "moeda",
      tipo: "derivada",
      requer: ["receita", "quantidade"],
      calcular: (v) => (v.quantidade > 0 ? v.receita / v.quantidade : 0),
    },
    {
      id: "cmv",
      label: "CMV",
      descricao: "Custo da mercadoria vendida, apurado pelos movimentos de estoque da venda.",
      formato: "moeda",
      permissao: "relatorio.financeiro",
      tipo: "soma",
      campo: "cmv",
    },
    {
      id: "margem",
      label: "Margem",
      descricao: "Receita menos CMV, em reais.",
      formato: "moeda",
      permissao: "relatorio.financeiro",
      tipo: "derivada",
      requer: ["receita", "cmv"],
      calcular: (v) => v.receita - v.cmv,
    },
    {
      id: "margemPct",
      label: "Margem %",
      descricao: "Margem sobre a receita, em porcentagem.",
      formato: "percentual",
      permissao: "relatorio.financeiro",
      tipo: "derivada",
      requer: ["receita", "cmv"],
      calcular: (v) => (v.receita > 0 ? ((v.receita - v.cmv) / v.receita) * 100 : 0),
    },
  ],
  padrao: { dimensoes: ["produto"], metricas: ["receita", "quantidade"] },
};

// ── Registro ────────────────────────────────────────────────

/**
 * Fatos com carregador implementado. O motor recusa o que não estiver aqui —
 * então o catálogo nunca promete uma consulta que não sabe executar.
 */
export const CATALOGO: FatoDef[] = [VENDA_ITEM];

export function getFato(id: string): FatoDef | undefined {
  return CATALOGO.find((f) => f.id === id);
}

export function getDimensao(fato: FatoDef, id: string): DimensaoDef | undefined {
  return fato.dimensoes.find((d) => d.id === id);
}

export function getMetrica(fato: FatoDef, id: string): MetricaDef | undefined {
  return fato.metricas.find((m) => m.id === id);
}

/** Dimensão temporal do fato, se houver — quem decide se cabe granularidade. */
export function dimensaoTemporal(fato: FatoDef): DimensaoDef | undefined {
  return fato.dimensoes.find((d) => d.temporal);
}

// ── Projeção para o cliente ─────────────────────────────────

export type MetricaCliente = {
  id: string;
  label: string;
  descricao: string;
  formato: Formato;
};

export type FatoCliente = Omit<FatoDef, "metricas"> & { metricas: MetricaCliente[] };

/**
 * Versão serializável do fato, para os seletores da tela.
 *
 * Duas coisas acontecem aqui: as funções `calcular` ficam no servidor (não
 * atravessam a fronteira do RSC) e as métricas que a permissão não alcança
 * somem da lista — quem não tem `relatorio.financeiro` nem vê "Margem" como
 * opção. O corte de verdade continua sendo o do motor; este é só a cortesia
 * de não oferecer o que não vai funcionar.
 */
export function fatoParaCliente(fato: FatoDef, acessos: Acesso[]): FatoCliente {
  return {
    ...fato,
    metricas: fato.metricas
      .filter((m) => !m.permissao || podeEmAlguma(acessos, m.permissao))
      .map(({ id, label, descricao, formato }) => ({ id, label, descricao, formato })),
  };
}

export function catalogoParaCliente(acessos: Acesso[]): FatoCliente[] {
  return CATALOGO.map((f) => fatoParaCliente(f, acessos));
}

/**
 * Campos base que precisam sair do carregador para atender estas métricas —
 * inclui o que só as derivadas exigem (pedir margem carrega receita e cmv).
 */
export function basesNecessarias(fato: FatoDef, metricas: string[]): {
  somas: string[];
  distintos: string[];
} {
  const somas = new Set<string>();
  const distintos = new Set<string>();

  const incluir = (id: string, profundidade = 0) => {
    if (profundidade > 4) return; // derivada de derivada não recursa sem fim
    const m = getMetrica(fato, id);
    if (!m) return;
    if (m.tipo === "soma") somas.add(m.campo);
    else if (m.tipo === "distinto") distintos.add(m.chave);
    else for (const dep of m.requer) incluir(dep, profundidade + 1);
  };

  for (const id of metricas) incluir(id);
  return { somas: [...somas], distintos: [...distintos] };
}
