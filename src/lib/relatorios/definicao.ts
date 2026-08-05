import { podeEmAlguma, type Acesso, type Permissao } from "@/lib/permissoes";
import type { EstoquePolicy } from "@/lib/estoque-estrategia";
import type { Periodo } from "@/lib/periodo";
import type { CategoriaId, Exportacao } from "./catalogo";

/**
 * Definição de relatório — o contrato ÚNICO de geração do sistema.
 *
 * Um relatório não escreve mais tela, export nem PDF: ele declara o que tem
 * (filtros, colunas, ordenações, agrupamentos, indicadores) e de onde vem a
 * linha (`carregar`). Todo o resto — configurar, filtrar, ordenar, agrupar,
 * totalizar, pré-visualizar, exportar em CSV/Excel/PDF e escolher a orientação
 * do papel — é feito pelo mesmo motor (`executar.ts`) e pela mesma tela
 * (`_configurador/`).
 *
 * Consequência prática: relatório novo é UM objeto neste formato. Nenhuma tela
 * nova, nenhuma rota nova, nenhum layout de PDF novo.
 *
 * Módulo puro (sem `server-only`): os TIPOS atravessam a fronteira RSC. As
 * funções (`carregar`, `calcular`) ficam no servidor — quem vai para o client é
 * a projeção `definicaoParaCliente`.
 */

// ── Valores ─────────────────────────────────────────────────

/** Como o valor é formatado, alinhado e — no PDF — quanto espaço merece. */
export type TipoValor =
  | "texto"
  | "codigo"
  | "moeda"
  | "numero"
  | "inteiro"
  | "percentual"
  | "data"
  | "datahora"
  | "booleano";

/** Uma linha crua vinda da fonte. A chave casa com o `id` da coluna. */
export type ValorCelula = string | number | boolean | Date | null | undefined;
export type Linha = Record<string, ValorCelula>;

// ── Filtros ─────────────────────────────────────────────────

export type ModoFiltro = "contem" | "igual" | "maior" | "menor" | "verdadeiro" | "falso";

/**
 * Um filtro que ESTE relatório oferece. Nada é fixo: quem não declara período
 * não mostra período, quem não declara fornecedor não mostra fornecedor.
 *
 * `periodo` e `site` chegam ao carregador (viram WHERE no banco). Os demais são
 * aplicados pelo motor sobre a coluna indicada — é o que dá filtro de graça a
 * qualquer coluna, sem uma linha de código no relatório.
 */
export type FiltroDef = {
  id: string;
  label: string;
  /** Frase curta abaixo do campo. Explica o que o filtro faz, não o óbvio. */
  ajuda?: string;
  permissao?: Permissao;
  /** Valor inicial ao abrir a configuração. */
  padrao?: string | number | boolean | string[];
  /**
   * O carregador já aplicou este filtro (empurrou para o banco). O motor não
   * refiltra — a coluna pode nem estar na linha que voltou, e refiltrar
   * apagaria o resultado inteiro.
   */
  aplicaNaFonte?: boolean;
} & (
  | { tipo: "periodo" }
  | { tipo: "site" }
  | { tipo: "texto"; coluna: string; modo?: Extract<ModoFiltro, "contem" | "igual">; placeholder?: string }
  | {
      tipo: "opcoes";
      coluna: string;
      /** Lista fixa. Para lista vinda do banco use `fonteOpcoes`. */
      opcoes?: { valor: string; label: string }[];
      /** Opções carregadas no servidor (categorias, marcas, fornecedores…). */
      fonteOpcoes?: FonteOpcoes;
      multiplo?: boolean;
    }
  | { tipo: "numero"; coluna: string; modo: Extract<ModoFiltro, "maior" | "menor">; sufixo?: string }
  | { tipo: "booleano"; coluna: string; modo?: Extract<ModoFiltro, "verdadeiro" | "falso"> }
);

/** Listas que o servidor sabe montar para os filtros de opção. */
export type FonteOpcoes = "categorias" | "marcas" | "fornecedores" | "sites" | "formasPagamento";

export type OpcaoFiltro = { valor: string; label: string };

// ── Colunas ─────────────────────────────────────────────────

export type ColunaDef = {
  id: string;
  label: string;
  tipo: TipoValor;
  /** Não pode ser desmarcada — sem ela a linha perde a identidade. */
  obrigatoria?: boolean;
  /** Vem marcada ao abrir. Padrão: `true`. */
  padrao?: boolean;
  /** Entra na linha de total (e nos subtotais de grupo). */
  totalizar?: "soma" | "media";
  /**
   * Peso de largura no PDF. Quase sempre desnecessário: o motor mede o
   * conteúdo real e o layout se ajusta sozinho.
   */
  peso?: number;
  align?: "left" | "right" | "center";
  permissao?: Permissao;
};

// ── Ordenação e agrupamento ─────────────────────────────────

export type OrdenacaoDef = {
  id: string;
  label: string;
  /** Coluna da linha crua pela qual ordenar (pode não estar visível). */
  coluna: string;
  ordem?: "asc" | "desc";
};

export type AgrupamentoDef = {
  id: string;
  label: string;
  coluna: string;
};

// ── Indicadores (resumo executivo) ──────────────────────────

export type IndicadorDef = {
  id: string;
  label: string;
  tipo: TipoValor;
  hint?: string;
  permissao?: Permissao;
  /** Recebe as linhas JÁ FILTRADAS — o resumo fala do que está na tela. */
  calcular: (linhas: Linha[]) => number;
};

// ── Layout ──────────────────────────────────────────────────

/**
 * Dicas de papel. Todas opcionais: sem nada, o motor decide pela quantidade e
 * pelo tipo das colunas escolhidas. Só existe para o caso raro em que o
 * relatório sabe algo que a medição não vê.
 */
export type LayoutHint = {
  orientacao?: "retrato" | "paisagem";
  /** Acima disto vira paisagem. Padrão: 7. */
  limiteColunasRetrato?: number;
  /** Esconde a faixa de indicadores no PDF. */
  ocultarIndicadores?: boolean;
};

// ── Fonte ───────────────────────────────────────────────────

/** O que o carregador recebe. Período e loja já resolvidos. */
export type FonteCtx = {
  /** null quando o relatório não usa período (retrato ao vivo). */
  periodo: Periodo | null;
  /** Loja ativa no seletor do app. null = todas as permitidas. */
  siteId: string | null;
  acessos: Acesso[];
  policy: EstoquePolicy;
  /** Valores brutos dos filtros, por `id` do FiltroDef. */
  filtros: Record<string, string | number | boolean | string[]>;
  /**
   * Colunas que o operador quer ver, na ordem. O carregador pode usar para
   * buscar menos (não ir atrás de fornecedor quando ninguém pediu fornecedor).
   * Ignorar é seguro: o motor projeta as colunas de qualquer jeito.
   */
  colunas: string[];
  /** Ordenação pedida — dá ao carregador a chance de empurrar o ORDER BY. */
  ordenar?: { coluna: string; ordem: "asc" | "desc" };
};

export type Fonte = (ctx: FonteCtx) => Promise<Linha[]>;

// ── Definição ───────────────────────────────────────────────

export type ReportDefinition = {
  /** Casa com o `id` do catálogo — favorito, histórico e agendamento seguem valendo. */
  id: string;
  nome: string;
  descricao: string;
  categoria: CategoriaId;
  icon: string;
  permissao: Permissao;

  filtros: FiltroDef[];
  colunas: ColunaDef[];
  ordenacoes: OrdenacaoDef[];
  agrupamentos: AgrupamentoDef[];
  indicadores: IndicadorDef[];
  exportacoes: Exportacao[];
  layout?: LayoutHint;

  /** Ordenação inicial, quando o operador não escolhe. */
  ordenacaoPadrao?: { coluna: string; ordem: "asc" | "desc" };
  /** Teto de linhas do resultado. Padrão: 1000. */
  limitePadrao?: number;

  carregar: Fonte;
};

// ── Projeção para o cliente ─────────────────────────────────

export type ColunaCliente = Omit<ColunaDef, "permissao">;
export type IndicadorCliente = Omit<IndicadorDef, "calcular" | "permissao">;

/**
 * Versão serializável da definição — o que a tela de configuração consome.
 *
 * Duas coisas acontecem aqui: as funções ficam no servidor (não atravessam a
 * fronteira RSC) e o que a permissão não alcança some da lista. O corte de
 * verdade continua sendo o do motor; aqui é a cortesia de não oferecer o que
 * não vai funcionar.
 */
export type ReportDefinitionCliente = {
  id: string;
  nome: string;
  descricao: string;
  categoria: CategoriaId;
  icon: string;
  filtros: FiltroDef[];
  colunas: ColunaCliente[];
  ordenacoes: OrdenacaoDef[];
  agrupamentos: AgrupamentoDef[];
  indicadores: IndicadorCliente[];
  exportacoes: Exportacao[];
  ordenacaoPadrao?: { coluna: string; ordem: "asc" | "desc" };
  limitePadrao?: number;
  /** Opções já resolvidas por `id` de filtro — o client não consulta banco. */
  opcoes: Record<string, OpcaoFiltro[]>;
};

export function definicaoParaCliente(
  def: ReportDefinition,
  acessos: Acesso[],
  opcoes: Record<string, OpcaoFiltro[]> = {},
): ReportDefinitionCliente {
  const permitido = (p?: Permissao) => !p || podeEmAlguma(acessos, p);
  const colunas = def.colunas.filter((c) => permitido(c.permissao));
  const visiveis = new Set(colunas.map((c) => c.id));

  return {
    id: def.id,
    nome: def.nome,
    descricao: def.descricao,
    categoria: def.categoria,
    icon: def.icon,
    filtros: def.filtros.filter((f) => permitido(f.permissao)),
    colunas: colunas.map(({ permissao: _p, ...c }) => c),
    // Ordenar/agrupar por coluna que a permissão cortou não é opção de verdade.
    ordenacoes: def.ordenacoes.filter((o) => visiveis.has(o.coluna) || !temColuna(def, o.coluna)),
    agrupamentos: def.agrupamentos.filter((g) => visiveis.has(g.coluna) || !temColuna(def, g.coluna)),
    indicadores: def.indicadores
      .filter((i) => permitido(i.permissao))
      .map(({ calcular: _c, permissao: _p, ...i }) => i),
    exportacoes: def.exportacoes,
    ordenacaoPadrao: def.ordenacaoPadrao,
    limitePadrao: def.limitePadrao,
    opcoes,
  };
}

function temColuna(def: ReportDefinition, id: string): boolean {
  return def.colunas.some((c) => c.id === id);
}

// ── Consultas à definição ───────────────────────────────────

export function getColuna(
  def: ReportDefinition | ReportDefinitionCliente,
  id: string,
): ColunaCliente | undefined {
  return def.colunas.find((c) => c.id === id);
}

/** Colunas marcadas ao abrir: as obrigatórias e as com `padrao !== false`. */
export function colunasPadrao(def: ReportDefinition | ReportDefinitionCliente): string[] {
  return def.colunas.filter((c) => c.obrigatoria || c.padrao !== false).map((c) => c.id);
}

export function usaPeriodo(def: ReportDefinition | ReportDefinitionCliente): boolean {
  return def.filtros.some((f) => f.tipo === "periodo");
}

/** Alinhamento efetivo: número puxa para a direita sem ninguém pedir. */
export function alinhamento(coluna: { tipo: TipoValor; align?: ColunaDef["align"] }): "left" | "right" | "center" {
  if (coluna.align) return coluna.align;
  return NUMERICOS.has(coluna.tipo) ? "right" : "left";
}

export const NUMERICOS: ReadonlySet<TipoValor> = new Set<TipoValor>([
  "moeda",
  "numero",
  "inteiro",
  "percentual",
]);
