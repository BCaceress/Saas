// ============================================================
// Unidades comerciais da NF-e — o que a sigla do fornecedor significa.
//
// O XML fatura na unidade de VENDA DO FORNECEDOR (uCom): "0,6 MI" é meio
// milheiro de cigarro, 600 maços — não seis décimos de maço. Sem esta tabela a
// tela mostrava "0,6" e o estoque recebia 0,6, e o buraco só aparecia no
// inventário.
//
// Três naturezas, e a diferença entre elas é o ponto:
//
// · MÚLTIPLO FIXO (MI, DZ, CENTO) — a sigla JÁ diz quantas unidades são, em
//   qualquer produto do mundo. Milheiro é mil. Aqui dá para converter sozinho.
// · EMBALAGEM (CX, FD, DP) — a sigla não diz nada: caixa de long neck tem 12,
//   caixa de suco tem 6. Só o cadastro do produto responde, e enquanto não
//   responder a tela PERGUNTA em vez de chutar 1.
// · MEDIDA (KG, L, M) — grandeza contínua. Converter para "unidades" exige
//   saber quanto pesa cada peça, o que é do produto, não da sigla.
//
// Puro e sem `server-only`: a mesma tabela decide o que a importação grava e o
// que a tela de recebimento mostra. Duas cópias viram dois estoques.
// ============================================================

/** Unidade em que o estoque conta — a entrada sempre soma unidade fechada. */
export const UNIDADE_ESTOQUE = "UN";

export type ClasseUnidade =
  /** Já é a unidade de prateleira (UN, PÇ). */
  | "UNITARIA"
  /** Vale um número fixo de unidades, sempre (MI, DZ, CENTO). */
  | "MULTIPLO"
  /** Depende do cadastro do produto (CX, FD, DP, PCT). */
  | "EMBALAGEM"
  /** Grandeza contínua (KG, L, M) — não vira peça sem saber o produto. */
  | "MEDIDA";

export type UnidadeComercial = {
  /** Sigla canônica, como a tela escreve. */
  sigla: string;
  /** Nome por extenso, para tooltip e cadastro. */
  nome: string;
  classe: ClasseUnidade;
  /**
   * Quantas unidades da `base` cabem em 1 desta. `null` = depende do produto.
   * Milheiro é 1000 UN em qualquer lugar; caixa não é nada sem cadastro.
   */
  fator: number | null;
  /** Em que unidade o `fator` é expresso. */
  base: "UN" | "KG" | "L" | "M" | null;
};

/**
 * Uma entrada por sigla canônica; os apelidos que os fornecedores escrevem
 * ficam em `APELIDOS`. Fonte: unidades usuais da NF-e mais o que aparece de
 * verdade em nota de distribuidor de bebida e tabacaria.
 */
const CATALOGO: UnidadeComercial[] = [
  { sigla: "UN", nome: "Unidade", classe: "UNITARIA", fator: 1, base: "UN" },
  { sigla: "PC", nome: "Peça", classe: "UNITARIA", fator: 1, base: "UN" },

  { sigla: "PAR", nome: "Par", classe: "MULTIPLO", fator: 2, base: "UN" },
  { sigla: "DZ", nome: "Dúzia", classe: "MULTIPLO", fator: 12, base: "UN" },
  { sigla: "CENTO", nome: "Cento", classe: "MULTIPLO", fator: 100, base: "UN" },
  // O caso da tabacaria: cigarro é faturado em milheiro, e em fração dele.
  { sigla: "MI", nome: "Milheiro", classe: "MULTIPLO", fator: 1000, base: "UN" },

  { sigla: "CX", nome: "Caixa", classe: "EMBALAGEM", fator: null, base: "UN" },
  { sigla: "FD", nome: "Fardo", classe: "EMBALAGEM", fator: null, base: "UN" },
  { sigla: "DP", nome: "Display", classe: "EMBALAGEM", fator: null, base: "UN" },
  { sigla: "PCT", nome: "Pacote", classe: "EMBALAGEM", fator: null, base: "UN" },
  { sigla: "BD", nome: "Bandeja", classe: "EMBALAGEM", fator: null, base: "UN" },
  { sigla: "ENG", nome: "Engradado", classe: "EMBALAGEM", fator: null, base: "UN" },
  { sigla: "SC", nome: "Saco", classe: "EMBALAGEM", fator: null, base: "UN" },
  { sigla: "GF", nome: "Garrafa", classe: "EMBALAGEM", fator: null, base: "UN" },
  { sigla: "PT", nome: "Pote", classe: "EMBALAGEM", fator: null, base: "UN" },
  { sigla: "KIT", nome: "Kit", classe: "EMBALAGEM", fator: null, base: "UN" },
  { sigla: "RL", nome: "Rolo", classe: "EMBALAGEM", fator: null, base: "UN" },
  { sigla: "BB", nome: "Bombona", classe: "EMBALAGEM", fator: null, base: "UN" },

  { sigla: "KG", nome: "Quilograma", classe: "MEDIDA", fator: 1, base: "KG" },
  { sigla: "G", nome: "Grama", classe: "MEDIDA", fator: 0.001, base: "KG" },
  { sigla: "MG", nome: "Miligrama", classe: "MEDIDA", fator: 0.000001, base: "KG" },
  { sigla: "TON", nome: "Tonelada", classe: "MEDIDA", fator: 1000, base: "KG" },
  { sigla: "L", nome: "Litro", classe: "MEDIDA", fator: 1, base: "L" },
  { sigla: "ML", nome: "Mililitro", classe: "MEDIDA", fator: 0.001, base: "L" },
  { sigla: "M3", nome: "Metro cúbico", classe: "MEDIDA", fator: 1000, base: "L" },
  { sigla: "M", nome: "Metro", classe: "MEDIDA", fator: 1, base: "M" },
  { sigla: "CM", nome: "Centímetro", classe: "MEDIDA", fator: 0.01, base: "M" },
  { sigla: "MM", nome: "Milímetro", classe: "MEDIDA", fator: 0.001, base: "M" },
  { sigla: "KM", nome: "Quilômetro", classe: "MEDIDA", fator: 1000, base: "M" },
  { sigla: "M2", nome: "Metro quadrado", classe: "MEDIDA", fator: 1, base: null },
];

/** Como o fornecedor escreve × a sigla que este catálogo usa. */
const APELIDOS: Record<string, string> = {
  UND: "UN",
  UNID: "UN",
  UNIDADE: "UN",
  PECA: "PC",
  PÇ: "PC",
  PECAS: "PC",
  PR: "PAR",
  DUZIA: "DZ",
  DUZ: "DZ",
  DUZIAS: "DZ",
  CEM: "CENTO",
  CT: "CENTO",
  MIL: "MI",
  MILHEIRO: "MI",
  MLH: "MI",
  CAIXA: "CX",
  CS: "CX",
  CXA: "CX",
  FARDO: "FD",
  DISPLAY: "DP",
  PACOTE: "PCT",
  PAC: "PCT",
  BDJ: "BD",
  BANDEJA: "BD",
  EG: "ENG",
  SACO: "SC",
  SACA: "SC",
  GFA: "GF",
  GAR: "GF",
  GARRAFA: "GF",
  POTE: "PT",
  ROLO: "RL",
  KGS: "KG",
  QUILO: "KG",
  GR: "G",
  GRS: "G",
  GRAMA: "G",
  TN: "TON",
  T: "TON",
  LT: "L",
  LTS: "L",
  LITRO: "L",
  MLT: "ML",
  MT: "M",
  MTS: "M",
};

const POR_SIGLA = new Map(CATALOGO.map((u) => [u.sigla, u]));

/** Normaliza o que veio no XML: "cx24 " → "CX24" → "CX". */
function canonica(unidade: string | null | undefined): string | null {
  const bruto = (unidade ?? "").trim().toUpperCase();
  if (!bruto) return null;
  if (POR_SIGLA.has(bruto)) return bruto;
  if (APELIDOS[bruto]) return APELIDOS[bruto];
  // "CX24", "FD12" — sigla colada no fator, comum em distribuidor de bebida.
  // O número é descartado: quantas cabem é o fator de conversão, não o nome.
  const soLetras = bruto.replace(/[^A-ZÇ]/g, "");
  if (POR_SIGLA.has(soLetras)) return soLetras;
  return APELIDOS[soLetras] ?? null;
}

/**
 * O que esta sigla é. `null` quando o catálogo não conhece — e aí a tela
 * PERGUNTA, que é diferente de assumir 1.
 */
export function unidadeComercial(unidade: string | null | undefined): UnidadeComercial | null {
  const sigla = canonica(unidade);
  return sigla ? (POR_SIGLA.get(sigla) ?? null) : null;
}

/**
 * Quantas unidades de estoque cabem em 1 desta unidade — só quando a sigla
 * responde sozinha (milheiro, dúzia, cento).
 *
 * `null` para caixa, fardo e quilo de propósito: ali a resposta é do produto,
 * não da unidade, e devolver 1 seria a mentira que põe 3 caixas como 3
 * garrafas no saldo.
 */
export function fatorDaUnidade(unidade: string | null | undefined): number | null {
  const u = unidadeComercial(unidade);
  if (!u || u.base !== "UN" || u.fator == null) return null;
  return u.fator;
}

/** Grandeza contínua? Peso e volume não viram peça sem saber o produto. */
export function unidadeContinua(unidade: string | null | undefined): boolean {
  return unidadeComercial(unidade)?.classe === "MEDIDA";
}

/**
 * Como escrever a unidade para o operador: "MI (milheiro)".
 *
 * A sigla sozinha é o que ele lê no papel; o nome é o que faz "0,6" parar de
 * parecer "menos de um".
 */
export function rotuloDaUnidade(unidade: string | null | undefined): string {
  const bruto = (unidade ?? "").trim().toUpperCase();
  const u = unidadeComercial(unidade);
  if (!u) return bruto || UNIDADE_ESTOQUE;
  return u.sigla === bruto || !bruto ? u.nome : `${bruto} (${u.nome.toLowerCase()})`;
}

// ── Unidade é peça: não existe meia ─────────────────────────

/**
 * Ruído de ponto flutuante. 0,6 × 1000 dá 600.0000000000001 em binário — isso
 * é inteiro, e tratar como fração faria a tela recusar a nota certa.
 */
const EPSILON = 1e-6;

export type UnidadesDaLinha = {
  /** Sempre inteiro — é o que pode virar saldo. */
  unidades: number;
  /** A conta fechou em inteiro de verdade, ou o inteiro é arredondamento? */
  exata: boolean;
  /** O produto cru, para a mensagem de erro dizer o que não fechou. */
  bruto: number;
};

/**
 * Quantas unidades a linha vira — e se a conta fecha.
 *
 * O saldo conta PEÇA: não existe meia garrafa fechada no estoque. Quando
 * `quantidade × fator` cai em fração (0,5 CX × 3 = 1,5), a conversão está
 * errada — ou a caixa não tem 3, ou a nota não veio em caixa. Gravar 1,5 (ou
 * arredondar em silêncio para 2) é inventar mercadoria que ninguém recebeu.
 */
export function unidadesDaLinha(quantidade: number, fator: number): UnidadesDaLinha {
  const bruto = quantidade * (fator || 1);
  const inteiro = Math.round(bruto);
  // Tolerância proporcional: 600 000 tem ruído maior que 600.
  const folga = Math.max(EPSILON, Math.abs(bruto) * 1e-9);
  return { unidades: inteiro, exata: Math.abs(bruto - inteiro) <= folga, bruto };
}

/** A conta fecha em peças inteiras? */
export function conversaoFechaEmInteiro(quantidade: number, fator: number): boolean {
  return unidadesDaLinha(quantidade, fator).exata;
}

/**
 * As unidades que podem ir para o saldo — ou um erro que diz o porquê.
 *
 * Última barreira, do lado do servidor: toda gravação de estoque passa por
 * aqui. Uma tela nova que esqueça de validar não consegue criar meia peça.
 */
export function unidadesParaEstoque(
  quantidade: number,
  fator: number,
  contexto?: string,
): number {
  const r = unidadesDaLinha(quantidade, fator);
  if (!r.exata) {
    const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
    throw new Error(
      `${contexto ? `${contexto}: a` : "A"} conversão não fecha em unidades inteiras — ` +
        `${fmt(quantidade)} × ${fmt(fator)} = ${fmt(r.bruto)}. ` +
        `O estoque conta peças, não frações: corrija a conversão antes de receber.`,
    );
  }
  return r.unidades;
}

/** "1 MI = 1.000 UN" — a frase que a linha do recebimento mostra. */
export function frasesDeConversao(unidade: string | null | undefined, fator: number): string {
  const sigla = (unidade ?? "").trim().toUpperCase() || UNIDADE_ESTOQUE;
  return `1 ${sigla} = ${fator.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${UNIDADE_ESTOQUE}`;
}
