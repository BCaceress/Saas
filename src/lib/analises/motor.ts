import "server-only";
import { brl } from "@/lib/utils";
import { pct, resolvePeriodo, variacao, type Periodo } from "@/lib/periodo";
import { POLICY_PADRAO, type EstoquePolicy } from "@/lib/estoque-estrategia";
import { podeEmAlguma, sitesPermitidos, type Acesso } from "@/lib/permissoes";
import {
  basesNecessarias,
  dimensaoTemporal,
  getDimensao,
  getFato,
  getMetrica,
  type FatoDef,
  type Formato,
  type MetricaDef,
} from "./catalogo";
import { rotuloDiaSemana, rotuloTempo } from "./fatos/tempo";
import { carregarVendaItem } from "./fatos/venda-item";
import type { Carregador, LinhaFato } from "./fatos/tipos";
import { MAX_LINHAS_FATO, type Consulta, type Filtro, type Granularidade } from "./schema";

/**
 * Motor de análises — executa uma `Consulta` do DSL.
 *
 * Pipeline: corta o que a permissão não alcança → carrega o fato no grão →
 * filtra → agrupa pelas dimensões → soma, conta distintos e calcula derivadas →
 * ordena → limita → formata em pt-BR (e, se pedido, compara com o período
 * anterior).
 *
 * Nada aqui monta SQL: os carregadores usam `db`, que injeta o `tenantId`. O
 * isolamento não depende da consulta estar bem formada.
 */

const CARREGADORES: Partial<Record<string, Carregador>> = {
  "venda-item": carregarVendaItem,
};

export type ColunaResultado = {
  id: string;
  header: string;
  tipo: "dimensao" | "metrica";
  formato: Formato;
  align?: "right";
};

export type ResultadoConsulta = {
  /** Consulta EFETIVA — o que de fato rodou depois do corte por permissão. */
  consulta: Consulta;
  fato: FatoDef;
  periodo: Periodo;
  colunas: ColunaResultado[];
  /** Linhas já formatadas em pt-BR. Tela, CSV e PDF consomem as mesmas. */
  linhas: string[][];
  /** Mesmas linhas com números crus — gráfico e insight da IA. */
  brutas: Record<string, string | number | null>[];
  /** Variação % vs. período anterior, por linha × métrica. Só com `comparar`. */
  variacoes?: (number | null)[][];
  totais: Record<string, number>;
  totaisTexto: string[];
  /** Grupos antes de aplicar o limite — "mostrando 20 de 137". */
  totalGrupos: number;
  truncado: boolean;
  /** Cortados por falta de `relatorio.financeiro` — a tela avisa em vez de mentir. */
  metricasRemovidas: string[];
  filtrosRemovidos: string[];
};

export class ConsultaInvalidaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ConsultaInvalidaError";
  }
}

// ── Permissão ───────────────────────────────────────────────

/**
 * Corta da consulta tudo que o operador não pode ver, ANTES de executar.
 *
 * Vale tanto para as métricas pedidas quanto para os FILTROS: deixar filtrar
 * por margem sem poder vê-la entregaria o número por tentativa e erro. Isso
 * mora no motor de propósito — a IA aceita texto livre, então esconder na tela
 * não seria proteção nenhuma.
 */
export function aplicarPermissoes(
  consulta: Consulta,
  fato: FatoDef,
  acessos: Acesso[],
): { consulta: Consulta; metricasRemovidas: string[]; filtrosRemovidos: string[] } {
  const bloqueada = (m: MetricaDef | undefined) =>
    !!m?.permissao && !podeEmAlguma(acessos, m.permissao);

  const metricasRemovidas: string[] = [];
  const metricas = consulta.metricas.filter((id) => {
    const m = getMetrica(fato, id);
    if (bloqueada(m)) {
      metricasRemovidas.push(m!.label);
      return false;
    }
    return true;
  });

  const filtrosRemovidos: string[] = [];
  const filtros = consulta.filtros.filter((f) => {
    const m = getMetrica(fato, f.campo);
    if (bloqueada(m)) {
      filtrosRemovidos.push(m!.label);
      return false;
    }
    return true;
  });

  // Sobrou consulta sem métrica: cai no padrão do fato (que é sempre livre),
  // para o operador ver o que pode em vez de uma tela de erro.
  const metricasFinais =
    metricas.length > 0
      ? metricas
      : fato.padrao.metricas.filter((id) => !bloqueada(getMetrica(fato, id)));

  // Ordenar por uma métrica que acabou de ser cortada não faz sentido — cai na
  // ordem padrão em vez de ordenar por uma coluna que não existe mais.
  const ordenar = bloqueada(getMetrica(fato, consulta.ordenar?.por ?? ""))
    ? undefined
    : consulta.ordenar;

  return {
    consulta: { ...consulta, metricas: metricasFinais, filtros, ordenar },
    metricasRemovidas,
    filtrosRemovidos,
  };
}

// ── Execução ────────────────────────────────────────────────

export type ExecutarArgs = {
  consulta: Consulta;
  acessos: Acesso[];
  /** Loja selecionada no seletor de análises. null = todas as permitidas. */
  siteId?: string | null;
  policy?: EstoquePolicy;
};

export type ConsultaPreparada = {
  fato: FatoDef;
  /** Consulta efetiva: permissões aplicadas, nomes inválidos descartados. */
  consulta: Consulta;
  periodo: Periodo;
  /** O que o carregador precisa trazer do banco. */
  campos: Set<string>;
  metricasRemovidas: string[];
  filtrosRemovidos: string[];
};

/**
 * Tudo que dá para decidir ANTES de tocar no banco: corte por permissão,
 * descarte de nomes inválidos, período e granularidade.
 *
 * Dimensão ou métrica que não existe no fato é descartada em silêncio — a IA
 * pode inventar um nome, e derrubar a consulta inteira por causa de um campo
 * errado seria pior do que responder o que dá para responder.
 */
export function prepararConsulta(consulta: Consulta, acessos: Acesso[]): ConsultaPreparada {
  const fato = getFato(consulta.fato);
  if (!fato) throw new ConsultaInvalidaError("Esse tipo de análise ainda não está disponível.");

  const cortada = aplicarPermissoes(consulta, fato, acessos);
  const dimensoes = cortada.consulta.dimensoes.filter((d) => getDimensao(fato, d));
  const metricas = cortada.consulta.metricas.filter((m) => getMetrica(fato, m));
  if (metricas.length === 0) {
    throw new ConsultaInvalidaError("Você não tem acesso às informações pedidas nesta análise.");
  }

  const periodo = resolvePeriodo({
    periodo: cortada.consulta.periodo.preset,
    de: cortada.consulta.periodo.de,
    ate: cortada.consulta.periodo.ate,
  });
  const granularidade = cortada.consulta.granularidade ?? granularidadePadrao(periodo);

  const bases = basesNecessarias(fato, metricas);
  return {
    fato,
    consulta: { ...cortada.consulta, dimensoes, metricas, granularidade },
    periodo,
    campos: new Set<string>([
      ...dimensoes,
      ...cortada.consulta.filtros.map((f) => f.campo),
      ...bases.somas,
      ...bases.distintos,
    ]),
    metricasRemovidas: cortada.metricasRemovidas,
    filtrosRemovidos: cortada.filtrosRemovidos,
  };
}

/**
 * Parte PURA do motor: das linhas no grão até o resultado formatado. Não sabe
 * de banco nem de tenant — recebe as linhas prontas. É aqui que mora toda a
 * matemática, e é por isso que ela pode ser testada sem subir nada.
 */
export function agregar(args: {
  preparada: ConsultaPreparada;
  linhas: LinhaFato[];
  /** Linhas do período anterior, quando a consulta pede comparação. */
  anteriores?: LinhaFato[] | null;
  truncado?: boolean;
}): ResultadoConsulta {
  const { fato, consulta, periodo } = args.preparada;
  const { dimensoes, metricas, filtros } = consulta;

  return montarResultado({
    fato,
    consulta,
    periodo,
    dimensoes,
    metricas,
    grupos: agrupar(args.linhas, dimensoes, fato, metricas, filtros),
    anteriores: args.anteriores
      ? agrupar(args.anteriores, dimensoes, fato, metricas, filtros)
      : null,
    truncado: args.truncado ?? false,
    metricasRemovidas: args.preparada.metricasRemovidas,
    filtrosRemovidos: args.preparada.filtrosRemovidos,
  });
}

export async function executarConsulta(args: ExecutarArgs): Promise<ResultadoConsulta> {
  const preparada = prepararConsulta(args.consulta, args.acessos);
  const { fato, consulta, periodo, campos } = preparada;

  const carregar = CARREGADORES[fato.id];
  if (!carregar) throw new ConsultaInvalidaError("Esse tipo de análise ainda não está disponível.");

  const base = {
    siteIds: resolverSites(args.acessos, args.siteId ?? null),
    campos,
    granularidade: consulta.granularidade ?? "dia",
    policy: args.policy ?? POLICY_PADRAO,
    limite: MAX_LINHAS_FATO,
  };

  const atual = await carregar({ ...base, range: { inicio: periodo.inicio, fim: periodo.fim } });
  const anterior =
    consulta.comparar && fato.usaPeriodo
      ? await carregar({ ...base, range: { inicio: periodo.prevInicio, fim: periodo.prevFim } })
      : null;

  return agregar({
    preparada,
    linhas: atual.linhas,
    anteriores: anterior?.linhas ?? null,
    truncado: atual.truncado || !!anterior?.truncado,
  });
}

/**
 * Lojas visíveis nesta consulta: interseção entre o que o perfil alcança e o
 * que o seletor escolheu. Acesso por loja vale aqui — não só no menu.
 */
function resolverSites(acessos: Acesso[], siteId: string | null): string[] | null {
  const permitidos = sitesPermitidos(acessos, "relatorio.ver");
  if (permitidos === "todas") return siteId ? [siteId] : null;
  if (!siteId) return permitidos;
  return permitidos.includes(siteId) ? [siteId] : [];
}

/** Período longo em dias vira gráfico ilegível — sobe o balde sozinho. */
function granularidadePadrao(periodo: Periodo): Granularidade {
  const dias = Math.round((periodo.fim.getTime() - periodo.inicio.getTime()) / 86_400_000);
  if (dias <= 2) return "hora";
  if (dias <= 62) return "dia";
  if (dias <= 400) return "semana";
  return "mes";
}

// ── Agregação ───────────────────────────────────────────────

type Grupo = {
  dims: (string | null)[];
  somas: Record<string, number>;
  distintos: Record<string, Set<string>>;
  /** Métricas finais (derivadas já resolvidas). Preenchido no fecho. */
  valores: Record<string, number>;
};

const SEM_VALOR = "—";

function agrupar(
  linhas: LinhaFato[],
  dimensoes: string[],
  fato: FatoDef,
  metricas: string[],
  filtros: Filtro[],
): Map<string, Grupo> {
  const filtrosDim = filtros.filter((f) => getDimensao(fato, f.campo));
  const filtrosMet = filtros.filter((f) => getMetrica(fato, f.campo));
  const grupos = new Map<string, Grupo>();

  for (const linha of linhas) {
    if (!passaFiltrosDimensao(linha, filtrosDim)) continue;

    const valores = dimensoes.map((d) => linha.dims[d] ?? null);
    const chave = valores.map((v) => v ?? "\u0000").join("\u001f");

    let g = grupos.get(chave);
    if (!g) {
      g = { dims: valores, somas: {}, distintos: {}, valores: {} };
      grupos.set(chave, g);
    }
    for (const [campo, valor] of Object.entries(linha.vals)) {
      g.somas[campo] = (g.somas[campo] ?? 0) + valor;
    }
    if (linha.chaves) {
      for (const [nome, valor] of Object.entries(linha.chaves)) {
        (g.distintos[nome] ??= new Set()).add(valor);
      }
    }
  }

  // Derivadas só depois da soma — ticket e margem % de grupo não são a soma
  // dos tickets e das margens das linhas.
  for (const g of grupos.values()) {
    g.valores = calcularMetricas(fato, metricas, g);
  }

  // Filtro sobre métrica ("margem abaixo de 10%") só faz sentido depois disso.
  if (filtrosMet.length > 0) {
    for (const [chave, g] of grupos) {
      const ok = filtrosMet.every((f) => comparar(g.valores[f.campo] ?? 0, f.op, f.valor));
      if (!ok) grupos.delete(chave);
    }
  }

  return grupos;
}

function calcularMetricas(fato: FatoDef, metricas: string[], g: Grupo): Record<string, number> {
  const base: Record<string, number> = { ...g.somas };
  for (const [nome, set] of Object.entries(g.distintos)) base[nome] = set.size;

  // Contagens distintas ficam disponíveis pelo id da métrica também, para as
  // derivadas (ticket precisa de `numVendas`, não de `venda`).
  for (const m of fato.metricas) {
    if (m.tipo === "distinto") base[m.id] = g.distintos[m.chave]?.size ?? 0;
  }

  const saida: Record<string, number> = {};
  const resolver = (id: string, profundidade = 0): number => {
    if (id in saida) return saida[id];
    const m = getMetrica(fato, id);
    if (!m) return 0;
    let v: number;
    if (m.tipo === "soma") v = base[m.campo] ?? 0;
    else if (m.tipo === "distinto") v = g.distintos[m.chave]?.size ?? 0;
    else if (profundidade > 4) v = 0;
    else {
      const deps: Record<string, number> = {};
      for (const dep of m.requer) deps[dep] = resolver(dep, profundidade + 1);
      v = m.calcular(deps);
    }
    if (!Number.isFinite(v)) v = 0;
    saida[id] = Math.round(v * 100) / 100;
    return saida[id];
  };

  for (const id of metricas) resolver(id);
  return saida;
}

// ── Filtros ─────────────────────────────────────────────────

function passaFiltrosDimensao(linha: LinhaFato, filtros: Filtro[]): boolean {
  return filtros.every((f) => comparar(linha.dims[f.campo] ?? null, f.op, f.valor));
}

function comparar(atual: string | number | null, op: Filtro["op"], alvo: Filtro["valor"]): boolean {
  if (op === "em") {
    const lista = Array.isArray(alvo) ? alvo : [alvo];
    return lista.some((v) => igual(atual, v));
  }
  if (Array.isArray(alvo)) return false;

  switch (op) {
    case "=":
      return igual(atual, alvo);
    case "!=":
      return !igual(atual, alvo);
    case "contem":
      return texto(atual).includes(texto(alvo));
    case ">=":
      return numero(atual) >= numero(alvo);
    case "<=":
      return numero(atual) <= numero(alvo);
  }
}

function igual(a: string | number | null, b: string | number | boolean): boolean {
  if (typeof a === "number" || typeof b === "number") return numero(a) === numero(b);
  return texto(a) === texto(b);
}

/** Comparação de texto tolerante: sem acento, sem caixa, sem espaço nas pontas. */
function texto(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function numero(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

// ── Montagem do resultado ───────────────────────────────────

function montarResultado(args: {
  fato: FatoDef;
  consulta: Consulta;
  periodo: Periodo;
  dimensoes: string[];
  metricas: string[];
  grupos: Map<string, Grupo>;
  anteriores: Map<string, Grupo> | null;
  truncado: boolean;
  metricasRemovidas: string[];
  filtrosRemovidos: string[];
}): ResultadoConsulta {
  const { fato, consulta, dimensoes, metricas, grupos, anteriores } = args;

  const colunas: ColunaResultado[] = [
    ...dimensoes.map((id) => {
      const d = getDimensao(fato, id)!;
      return { id, header: d.label, tipo: "dimensao" as const, formato: "texto" as Formato };
    }),
    ...metricas.map((id) => {
      const m = getMetrica(fato, id)!;
      return {
        id,
        header: m.label,
        tipo: "metrica" as const,
        formato: m.formato,
        align: "right" as const,
      };
    }),
  ];

  const entradas = ordenar([...grupos.entries()], { fato, consulta, dimensoes, metricas });
  const totalGrupos = entradas.length;
  const visiveis = entradas.slice(0, consulta.limite);

  const linhas: string[][] = [];
  const brutas: Record<string, string | number | null>[] = [];
  const variacoes: (number | null)[][] = [];

  for (const [chave, g] of visiveis) {
    const celulasDim = dimensoes.map((id, i) => rotuloDimensao(fato, id, g.dims[i], consulta));
    const celulasMet = metricas.map((id) => formatar(g.valores[id] ?? 0, formatoDe(fato, id)));
    linhas.push([...celulasDim, ...celulasMet]);

    const bruta: Record<string, string | number | null> = {};
    dimensoes.forEach((id, i) => {
      bruta[id] = rotuloDimensao(fato, id, g.dims[i], consulta);
    });
    for (const id of metricas) bruta[id] = g.valores[id] ?? 0;
    brutas.push(bruta);

    if (anteriores) {
      const prev = anteriores.get(chave);
      variacoes.push(
        metricas.map((id) => variacao(g.valores[id] ?? 0, prev?.valores[id] ?? 0).pct),
      );
    }
  }

  // Totais somam TODOS os grupos, não só os visíveis: "top 20" continua sendo
  // uma janela, e o rodapé precisa dizer a verdade sobre o período.
  const todos = entradas.map(([, g]) => g);
  const totais: Record<string, number> = {};
  for (const id of metricas) totais[id] = total(fato, id, todos);

  const totaisTexto = [
    ...dimensoes.map((_, i) => (i === 0 ? "Total" : "")),
    ...metricas.map((id) => formatar(totais[id] ?? 0, formatoDe(fato, id))),
  ];

  return {
    consulta,
    fato,
    periodo: args.periodo,
    colunas,
    linhas,
    brutas,
    variacoes: anteriores ? variacoes : undefined,
    totais,
    totaisTexto,
    totalGrupos,
    truncado: args.truncado,
    metricasRemovidas: args.metricasRemovidas,
    filtrosRemovidos: args.filtrosRemovidos,
  };
}

/**
 * Total de uma métrica sobre todos os grupos. Cada tipo tem a sua regra e
 * nenhuma delas é "somar a coluna":
 *  - soma      → soma mesmo;
 *  - distinto  → UNIÃO dos conjuntos (a mesma venda aparece no grupo de cada
 *                produto que ela levou; somar contaria de novo);
 *  - derivada  → a derivada dos totais (a média das margens não é a margem do
 *                período).
 */
function total(fato: FatoDef, id: string, grupos: Grupo[], profundidade = 0): number {
  const m = getMetrica(fato, id);
  if (!m) return 0;

  if (m.tipo === "soma") {
    return arredonda(grupos.reduce((s, g) => s + (g.valores[id] ?? 0), 0));
  }
  if (m.tipo === "distinto") {
    const uniao = new Set<string>();
    for (const g of grupos) for (const v of g.distintos[m.chave] ?? []) uniao.add(v);
    return uniao.size;
  }
  if (profundidade > 4) return 0;

  const deps: Record<string, number> = {};
  for (const dep of m.requer) deps[dep] = total(fato, dep, grupos, profundidade + 1);
  return arredonda(m.calcular(deps));
}

function arredonda(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function ordenar(
  entradas: [string, Grupo][],
  ctx: { fato: FatoDef; consulta: Consulta; dimensoes: string[]; metricas: string[] },
): [string, Grupo][] {
  const { fato, consulta, dimensoes, metricas } = ctx;
  const temporal = dimensaoTemporal(fato);
  const indiceTemporal = temporal ? dimensoes.indexOf(temporal.id) : -1;

  // Série no tempo se lê em ordem cronológica, não do maior para o menor.
  if (!consulta.ordenar && indiceTemporal >= 0) {
    return [...entradas].sort((a, b) =>
      String(a[1].dims[indiceTemporal] ?? "").localeCompare(String(b[1].dims[indiceTemporal] ?? "")),
    );
  }

  const por = consulta.ordenar?.por ?? metricas[0];
  const dir = consulta.ordenar?.ordem === "asc" ? 1 : -1;
  const iDim = dimensoes.indexOf(por);

  if (iDim >= 0) {
    return [...entradas].sort(
      (a, b) =>
        String(a[1].dims[iDim] ?? "").localeCompare(String(b[1].dims[iDim] ?? ""), "pt-BR") * dir,
    );
  }
  return [...entradas].sort((a, b) => ((a[1].valores[por] ?? 0) - (b[1].valores[por] ?? 0)) * dir);
}

// ── Formatação (pt-BR) ──────────────────────────────────────

function formatoDe(fato: FatoDef, id: string): Formato {
  return getMetrica(fato, id)?.formato ?? "numero";
}

export function formatar(valor: number, formato: Formato): string {
  switch (formato) {
    case "moeda":
      return brl(valor);
    case "percentual":
      return pct(valor, 1);
    case "inteiro":
      return valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
    case "numero":
      return valor.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
    default:
      return String(valor);
  }
}

/** Chave ordenável → rótulo legível (tempo e dia da semana viajam como chave). */
function rotuloDimensao(
  fato: FatoDef,
  id: string,
  valor: string | null,
  consulta: Consulta,
): string {
  if (valor == null || valor === "") return SEM_VALOR;
  if (getDimensao(fato, id)?.temporal) {
    return rotuloTempo(valor, consulta.granularidade ?? "dia");
  }
  if (id === "diaSemana") return rotuloDiaSemana(valor);
  return valor;
}
