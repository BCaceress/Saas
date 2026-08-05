import type { LayoutHint, TipoValor } from "./definicao";

/**
 * Layout automático da folha — o PDF se monta sozinho.
 *
 * O operador escolhe colunas, não papel. Quem decide orientação, largura de
 * coluna, tamanho de fonte, margem e quebra é este módulo, a partir de duas
 * coisas: quantas colunas foram escolhidas e QUANTO CADA UMA OCUPA de verdade
 * (medido no conteúdo já formatado, não estimado pelo tipo).
 *
 * Três regras que não se negociam:
 *  1. nunca cortar conteúdo — se não cabe encolhendo, quebra em duas linhas;
 *  2. nunca assumir largura fixa — a largura é sempre proporcional ao medido;
 *  3. cabeçalho repete em toda página (isso é CSS, ver `_folha-relatorio.tsx`).
 *
 * Módulo puro: dá para testar a decisão de layout sem renderizar nada.
 */

export type ColunaMedida = {
  label: string;
  tipo: TipoValor;
};

export type PlanoPdf = {
  orientacao: "retrato" | "paisagem";
  /** Margem da folha, em mm. Encolhe junto com a fonte quando aperta. */
  margemMm: number;
  larguraUtilMm: number;
  fontePt: number;
  fonteCabecalhoPt: number;
  /** Respiro vertical da célula, em pt. Acompanha a fonte. */
  paddingPt: number;
  /** Largura de cada coluna em % — soma 100, na ordem das colunas. */
  larguras: number[];
  /** Colunas autorizadas a quebrar em várias linhas (as largas de texto). */
  quebra: boolean[];
  /** 1 = tamanho cheio. Abaixo disso, a folha foi reduzida para caber. */
  escala: number;
  /** Por que saiu assim — a tela mostra ao operador antes de exportar. */
  motivo: string;
};

/** Página A4 em mm. O papel é o mesmo; o que gira é a orientação. */
const A4 = { curto: 210, longo: 297 };

const FONTE_BASE = 9.5;
const FONTE_MINIMA = 6;
const MARGEM_BASE = 14;
const LIMITE_COLUNAS_RETRATO = 7;

/**
 * Largura média de um caractere, em mm, para a fonte do corpo. 0.5em é a média
 * de uma sans-serif com mistura de dígitos, maiúsculas e minúsculas — erra
 * pouco e erra para o lado seguro (sobra, não falta).
 */
const EM_MM = 0.3528;
const CHAR_EM = 0.5;

/** Piso e teto de largura (em caracteres) por tipo — evita coluna espremida. */
const LIMITES: Record<TipoValor, { min: number; max: number }> = {
  texto: { min: 9, max: 46 },
  codigo: { min: 7, max: 18 },
  moeda: { min: 8, max: 15 },
  numero: { min: 6, max: 13 },
  inteiro: { min: 5, max: 12 },
  percentual: { min: 5, max: 10 },
  data: { min: 8, max: 12 },
  datahora: { min: 12, max: 17 },
  booleano: { min: 4, max: 7 },
};

/**
 * Largura que cada coluna PEDE, em caracteres.
 *
 * Usa o percentil 90 do conteúdo, não o máximo: um único nome de 60 caracteres
 * no meio de 500 linhas curtas não pode espremer o resto da tabela — ele quebra
 * em duas linhas e a folha continua legível.
 */
export function medirColunas(colunas: ColunaMedida[], linhas: string[][]): number[] {
  return colunas.map((col, i) => {
    const tamanhos = linhas.map((l) => (l[i] ?? "").length).sort((a, b) => a - b);
    const p90 = tamanhos.length > 0 ? tamanhos[Math.floor(tamanhos.length * 0.9)] : 0;
    const lim = LIMITES[col.tipo] ?? LIMITES.texto;
    // O cabeçalho também ocupa: coluna "Estoque disponível" nunca cabe em 6.
    const pedido = Math.max(p90 ?? 0, Math.min(col.label.length, 22));
    return Math.min(Math.max(pedido, lim.min), lim.max);
  });
}

export function planejarPdf(
  colunas: ColunaMedida[],
  linhas: string[][],
  hint?: LayoutHint,
): PlanoPdf {
  if (colunas.length === 0) {
    return {
      orientacao: "retrato",
      margemMm: MARGEM_BASE,
      larguraUtilMm: A4.curto - 2 * MARGEM_BASE,
      fontePt: FONTE_BASE,
      fonteCabecalhoPt: FONTE_BASE - 0.5,
      paddingPt: 3,
      larguras: [],
      quebra: [],
      escala: 1,
      motivo: "Sem colunas.",
    };
  }

  const pesos = medirColunas(colunas, linhas);
  const quebra = colunas.map(() => false);

  // ── 1. Orientação ────────────────────────────────────────
  const limiteRetrato = hint?.limiteColunasRetrato ?? LIMITE_COLUNAS_RETRATO;
  const cabeEmRetrato =
    colunas.length <= limiteRetrato &&
    soma(pesos) <= capacidade(A4.curto, MARGEM_BASE, FONTE_BASE, colunas.length);

  const orientacao = hint?.orientacao ?? (cabeEmRetrato ? "retrato" : "paisagem");
  const larguraFolha = orientacao === "retrato" ? A4.curto : A4.longo;

  const razaoOrientacao =
    hint?.orientacao != null
      ? "orientação definida pelo relatório"
      : orientacao === "paisagem"
        ? colunas.length > limiteRetrato
          ? `${colunas.length} colunas — mais de ${limiteRetrato} não cabem em pé`
          : "as colunas escolhidas são largas demais para o retrato"
        : `${colunas.length} colunas cabem em pé`;

  // ── 2. Encolher até caber ────────────────────────────────
  let fonte = FONTE_BASE;
  let margem = MARGEM_BASE;

  while (
    fonte > FONTE_MINIMA &&
    soma(pesos) > capacidade(larguraFolha, margem, fonte, colunas.length)
  ) {
    fonte = Math.round((fonte - 0.25) * 100) / 100;
    if (fonte <= 8.5 && margem > 10) margem = 10;
    if (fonte <= 7 && margem > 8) margem = 8;
  }

  // ── 3. Ainda não coube: quebrar as largas, nunca cortar ──
  let quebrou = false;
  for (const teto of [30, 24, 18, 14]) {
    if (soma(pesos) <= capacidade(larguraFolha, margem, fonte, colunas.length)) break;
    for (let i = 0; i < colunas.length; i++) {
      const t = colunas[i]!.tipo;
      if (t !== "texto" && t !== "codigo") continue;
      if (pesos[i]! <= teto) continue;
      pesos[i] = teto;
      quebra[i] = true;
      quebrou = true;
    }
  }

  const total = soma(pesos);
  const larguras = pesos.map((p) => Math.round((p / total) * 10000) / 100);

  const escala = Math.round((fonte / FONTE_BASE) * 100) / 100;
  const ajustes: string[] = [razaoOrientacao];
  if (escala < 1) ajustes.push(`fonte reduzida a ${fonte}pt e margem a ${margem}mm`);
  if (quebrou) ajustes.push("colunas de texto quebram em mais de uma linha");

  return {
    orientacao,
    margemMm: margem,
    larguraUtilMm: Math.round((larguraFolha - 2 * margem) * 10) / 10,
    fontePt: fonte,
    fonteCabecalhoPt: Math.max(fonte - 0.5, FONTE_MINIMA - 0.5),
    paddingPt: Math.max(1.5, Math.round(fonte * 0.32 * 10) / 10),
    larguras,
    quebra,
    escala,
    motivo: ajustes.join(" · "),
  };
}

/**
 * Quantos caracteres cabem numa linha desta folha, nesta fonte.
 *
 * O respiro lateral de cada coluna entra como pedágio: dez colunas gastam dez
 * respiros, e ignorar isso faria a conta prometer uma largura que não existe.
 */
function capacidade(
  larguraFolhaMm: number,
  margemMm: number,
  fontePt: number,
  nColunas: number,
): number {
  const respiro = fontePt * 0.56 * EM_MM; // ~0.28em de cada lado
  const util = larguraFolhaMm - 2 * margemMm - nColunas * respiro;
  return Math.max(10, Math.floor(util / (fontePt * CHAR_EM * EM_MM)));
}

function soma(v: number[]): number {
  return v.reduce((s, x) => s + x, 0);
}
