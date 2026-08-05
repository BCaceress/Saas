import "server-only";
import { podeEmAlguma, type Acesso, type Permissao } from "@/lib/permissoes";
import { resolvePeriodo, type Periodo } from "@/lib/periodo";
import { semAcento } from "@/lib/normalize";
import type { EstoquePolicy } from "@/lib/estoque-estrategia";
import {
  alinhamento,
  type ColunaDef,
  type FiltroDef,
  type Linha,
  type ReportDefinition,
  type TipoValor,
  type ValorCelula,
} from "./definicao";
import { descreverConfig, normalizarConfig, vazio, type ReportConfig } from "./config";
import { compararValores, formatarValor, numero, texto, valorCru } from "./valores";
import { planejarPdf, type PlanoPdf } from "./layout-pdf";

/**
 * Motor genérico de relatórios — o único lugar do sistema que gera relatório.
 *
 * Recebe uma definição (`definicao.ts`) e a configuração do operador
 * (`config.ts`) e faz sempre a mesma travessia:
 *
 *   carregar → filtrar → ordenar → agrupar → projetar colunas → totalizar →
 *   calcular indicadores → planejar a folha
 *
 * O resultado é UM objeto serializável que serve à prévia na tela, ao CSV, ao
 * Excel e ao PDF. É o que garante que os quatro mostrem o mesmo número: eles
 * não recalculam nada, só desenham o que sai daqui.
 */

export type ColunaResolvida = {
  id: string;
  label: string;
  tipo: TipoValor;
  align: "left" | "right" | "center";
  totalizar?: "soma" | "media";
};

export type GrupoResultado = {
  /** Valor do agrupamento, já formatado. */
  chave: string;
  linhas: string[][];
  /** Subtotais das colunas totalizáveis; `null` onde não há o que somar. */
  subtotais: (string | null)[];
  /** Linhas do grupo ANTES do limite — o rodapé do grupo não pode mentir. */
  total: number;
};

export type IndicadorResultado = {
  id: string;
  label: string;
  valor: string;
  hint?: string;
};

export type ResultadoRelatorio = {
  relatorioId: string;
  nome: string;
  descricao: string;
  /** null quando o relatório é um retrato ao vivo (posição de estoque). */
  periodoLabel: string | null;
  siteNome: string | null;
  /** Configuração EFETIVA — depois do saneamento e do corte por permissão. */
  config: ReportConfig;
  resumo: string;
  colunas: ColunaResolvida[];
  /** Linhas formatadas em pt-BR. Tela e PDF consomem as mesmas. */
  linhas: string[][];
  /** Mesmas linhas com número cru — só para CSV/Excel somarem a coluna. */
  cruas?: (string | number | null)[][];
  /** Quando há agrupamento; `null` = tabela plana. */
  grupos: GrupoResultado[] | null;
  indicadores: IndicadorResultado[];
  totais: (string | null)[];
  /** Linhas depois do filtro, antes do limite. */
  totalLinhas: number;
  exibidas: number;
  truncado: boolean;
  /** Colunas e indicadores cortados por permissão — a tela avisa em vez de mentir. */
  removidos: string[];
  plano: PlanoPdf;
  geradoEm: string;
};

export type ExecutarArgs = {
  def: ReportDefinition;
  config: unknown;
  acessos: Acesso[];
  siteId: string | null;
  siteNome: string | null;
  policy: EstoquePolicy;
  /** Inclui os valores crus (CSV/Excel). Fora do export é peso à toa. */
  incluirCruas?: boolean;
};

export async function executarRelatorio(args: ExecutarArgs): Promise<ResultadoRelatorio> {
  const { def, acessos } = args;
  const pode = (p?: Permissao) => !p || podeEmAlguma(acessos, p);

  // ── Corte por permissão ──────────────────────────────────
  // A projeção para o client já escondeu o que não pode; aqui é a trava de
  // verdade: uma config editada à mão não devolve coluna financeira a quem não
  // tem `relatorio.financeiro`.
  const removidos: string[] = [];
  const colunasPermitidas = def.colunas.filter((c) => {
    if (pode(c.permissao)) return true;
    removidos.push(c.label);
    return false;
  });
  const indicadoresPermitidos = def.indicadores.filter((i) => {
    if (pode(i.permissao)) return true;
    removidos.push(i.label);
    return false;
  });
  const filtrosPermitidos = def.filtros.filter((f) => pode(f.permissao));

  const defEfetiva: ReportDefinition = {
    ...def,
    colunas: colunasPermitidas,
    indicadores: indicadoresPermitidos,
    filtros: filtrosPermitidos,
  };

  const config = normalizarConfig(defEfetiva, args.config);

  // ── 1. Carregar ──────────────────────────────────────────
  const usaPeriodo = filtrosPermitidos.some((f) => f.tipo === "periodo");
  const periodo: Periodo | null = usaPeriodo
    ? resolvePeriodo({
        periodo: config.periodo.preset,
        de: config.periodo.de,
        ate: config.periodo.ate,
      })
    : null;

  const brutas = await defEfetiva.carregar({
    periodo,
    siteId: args.siteId,
    acessos,
    policy: args.policy,
    filtros: config.filtros,
    colunas: config.colunas,
    ordenar: config.ordenar,
  });

  // ── 2. Filtrar ───────────────────────────────────────────
  const filtradas = aplicarFiltros(brutas, filtrosPermitidos, config.filtros);

  // ── 3. Ordenar ───────────────────────────────────────────
  const colunaPorId = new Map(colunasPermitidas.map((c) => [c.id, c]));
  const ordenadas = ordenar(filtradas, config, defEfetiva, colunaPorId);

  // ── 4. Cortar ────────────────────────────────────────────
  const exibidas = ordenadas.slice(0, config.limite);
  const truncado = ordenadas.length > exibidas.length;

  // ── 5. Projetar colunas ──────────────────────────────────
  const colunas: ColunaResolvida[] = config.colunas
    .map((id) => colunaPorId.get(id))
    .filter((c): c is ColunaDef => !!c)
    .map((c) => ({
      id: c.id,
      label: c.label,
      tipo: c.tipo,
      align: alinhamento(c),
      totalizar: c.totalizar,
    }));

  const linhas = exibidas.map((l) => colunas.map((c) => formatarValor(l[c.id], c.tipo)));

  // ── 6. Agrupar ───────────────────────────────────────────
  const agrupamento = defEfetiva.agrupamentos.find((g) => g.id === config.agrupar);
  const grupos = agrupamento ? montarGrupos(exibidas, agrupamento.coluna, colunas) : null;

  // ── 7. Totais ────────────────────────────────────────────
  // Sobre as linhas EXIBIDAS: o rodapé fecha com a tabela impressa. Quando há
  // corte, `truncado` avisa — total que não bate com a soma visível é pior.
  const totais = totalizar(exibidas, colunas);

  // ── 8. Indicadores ───────────────────────────────────────
  // Sobre as FILTRADAS (antes do limite): o resumo executivo fala do universo
  // pedido, não das primeiras N linhas que couberam.
  const indicadores: IndicadorResultado[] = [
    {
      id: "__registros",
      label: "Registros",
      valor: formatarValor(filtradas.length, "inteiro"),
      hint: truncado ? `${exibidas.length} exibidos` : undefined,
    },
    ...indicadoresPermitidos.map((ind) => ({
      id: ind.id,
      label: ind.label,
      valor: formatarValor(ind.calcular(filtradas), ind.tipo),
      hint: ind.hint,
    })),
  ];

  // ── 9. Folha ─────────────────────────────────────────────
  const plano = planejarPdf(
    colunas.map((c) => ({ label: c.label, tipo: c.tipo })),
    linhas,
    defEfetiva.layout,
  );

  return {
    relatorioId: def.id,
    nome: def.nome,
    descricao: def.descricao,
    periodoLabel: periodo?.label ?? null,
    siteNome: args.siteNome,
    config,
    resumo: descreverConfig(defEfetiva, config),
    colunas,
    linhas,
    cruas: args.incluirCruas
      ? exibidas.map((l) => colunas.map((c) => valorCru(l[c.id], c.tipo)))
      : undefined,
    grupos,
    indicadores,
    totais,
    totalLinhas: filtradas.length,
    exibidas: exibidas.length,
    truncado,
    removidos,
    plano,
    geradoEm: new Date().toISOString(),
  };
}

// ── Filtro ──────────────────────────────────────────────────

/**
 * Filtros aplicados sobre a linha carregada.
 *
 * `periodo` e `site` não passam por aqui: eles viram WHERE no banco dentro do
 * carregador, porque filtrar depois de trazer o ano inteiro seria caro e
 * inútil. Todo o resto é genérico — é isso que dá filtro de graça a qualquer
 * coluna, sem uma linha de código no relatório.
 */
function aplicarFiltros(
  linhas: Linha[],
  defs: FiltroDef[],
  valores: ReportConfig["filtros"],
): Linha[] {
  const ativos = defs.filter(
    (f) =>
      f.tipo !== "periodo" && f.tipo !== "site" && !f.aplicaNaFonte && !vazio(valores[f.id]),
  );
  if (ativos.length === 0) return linhas;

  return linhas.filter((linha) =>
    ativos.every((f) => {
      if (f.tipo === "periodo" || f.tipo === "site") return true;
      const alvo = valores[f.id];
      const celula = linha[f.coluna];

      switch (f.tipo) {
        case "texto":
          return f.modo === "igual"
            ? normal(celula) === normal(alvo)
            : normal(celula).includes(normal(alvo));
        case "opcoes": {
          const lista = (Array.isArray(alvo) ? alvo : [String(alvo)]).map(normal);
          return lista.includes(normal(celula));
        }
        case "numero":
          return f.modo === "maior"
            ? numero(celula) >= Number(alvo)
            : numero(celula) <= Number(alvo);
        case "booleano": {
          // Um interruptor só filtra quando LIGADO ("somente zerados"); desligado
          // significa "não me importo", não "mostre só os falsos".
          if (alvo !== true) return true;
          return f.modo === "falso" ? !celula : !!celula;
        }
        default:
          return true;
      }
    }),
  );
}

function normal(v: unknown): string {
  return semAcento(texto(v as ValorCelula));
}

// ── Ordenação ───────────────────────────────────────────────

function ordenar(
  linhas: Linha[],
  config: ReportConfig,
  def: ReportDefinition,
  colunaPorId: Map<string, ColunaDef>,
): Linha[] {
  const escolha = config.ordenar ?? def.ordenacaoPadrao;
  if (!escolha) return linhas;

  const tipo: TipoValor =
    colunaPorId.get(escolha.coluna)?.tipo ??
    (def.ordenacoes.find((o) => o.coluna === escolha.coluna) ? "numero" : "texto");

  const sinal = escolha.ordem === "asc" ? 1 : -1;
  // Cópia: a fonte pode devolver um array memoizado por request (`cache`), e
  // ordenar in-place bagunçaria quem já leu o mesmo array.
  return [...linhas].sort(
    (a, b) => sinal * compararValores(a[escolha.coluna], b[escolha.coluna], tipo),
  );
}

// ── Agrupamento ─────────────────────────────────────────────

function montarGrupos(
  linhas: Linha[],
  coluna: string,
  colunas: ColunaResolvida[],
): GrupoResultado[] {
  const mapa = new Map<string, Linha[]>();
  for (const l of linhas) {
    const chave = texto(l[coluna]) || "Sem informação";
    const atual = mapa.get(chave);
    if (atual) atual.push(l);
    else mapa.set(chave, [l]);
  }

  return [...mapa.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "pt-BR", { sensitivity: "base" }))
    .map(([chave, doGrupo]) => ({
      chave,
      linhas: doGrupo.map((l) => colunas.map((c) => formatarValor(l[c.id], c.tipo))),
      subtotais: totalizar(doGrupo, colunas),
      total: doGrupo.length,
    }));
}

// ── Totais ──────────────────────────────────────────────────

function totalizar(linhas: Linha[], colunas: ColunaResolvida[]): (string | null)[] {
  let rotulado = false;
  return colunas.map((c) => {
    if (!c.totalizar) {
      // "Total" entra na primeira coluna sem soma — é onde o olho procura.
      if (!rotulado) {
        rotulado = true;
        return "Total";
      }
      return null;
    }
    const soma = linhas.reduce((s, l) => s + numero(l[c.id]), 0);
    const valor = c.totalizar === "media" ? (linhas.length > 0 ? soma / linhas.length : 0) : soma;
    return formatarValor(valor, c.tipo);
  });
}
