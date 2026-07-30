import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { ConectorError, type ConectorFornecedor, type Fonte } from "../types";
import { detectarColunas, linhasParaOfertas, type Linha } from "../tabela";

// ============================================================
// .xlsx sem dependência nova: o arquivo é um zip de XML. `fflate` descompacta
// e `fast-xml-parser` lê a primeira planilha. Cobre o que fornecedor manda —
// uma aba, cabeçalho na primeira linha com conteúdo. .xls antigo (binário)
// NÃO é suportado: peça "Salvar como .xlsx" ou CSV.
// ============================================================

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
});

export const planilhaConnector: ConectorFornecedor = {
  kind: "PLANILHA",
  rotulo: "Planilha (Excel)",
  extensoes: [".xlsx", ".xlsm"],

  async ler(fonte: Fonte, ctx) {
    if (fonte.tipo !== "arquivo") throw new ConectorError("O conector de planilha espera um arquivo.");

    const matriz = lerXlsx(fonte.bytes);
    if (matriz.length === 0) throw new ConectorError("A planilha está vazia.");

    const { cabecalhos, linhas } = matrizParaLinhas(matriz);
    if (cabecalhos.length === 0) throw new ConectorError("Não encontrei a linha de cabeçalho.");

    const mapa = detectarColunas(cabecalhos, ctx.mapeamento);
    return linhasParaOfertas(linhas, mapa);
  },
};

// ── Leitura do zip ──────────────────────────────────────────

type Celula = string;

/** Planilha como matriz de strings (linha × coluna). */
export function lerXlsx(bytes: Uint8Array): Celula[][] {
  let arquivos: Record<string, Uint8Array>;
  try {
    arquivos = unzipSync(bytes);
  } catch {
    throw new ConectorError("Arquivo não é um .xlsx válido. Salve como .xlsx ou CSV e tente de novo.");
  }

  const nomeAba = Object.keys(arquivos)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort()[0];
  if (!nomeAba) throw new ConectorError("Não encontrei nenhuma aba na planilha.");

  const compartilhadas = lerSharedStrings(arquivos["xl/sharedStrings.xml"]);
  const doc = parser.parse(new TextDecoder().decode(arquivos[nomeAba]));
  const rows = arr(doc?.worksheet?.sheetData?.row);

  const matriz: Celula[][] = [];
  for (const row of rows) {
    const linha: Celula[] = [];
    for (const c of arr(row?.c)) {
      const ref = String(c?.["@_r"] ?? "");
      const col = colunaParaIndice(ref);
      linha[col] = valorCelula(c, compartilhadas);
    }
    matriz.push(linha);
  }
  return matriz;
}

function lerSharedStrings(bytes?: Uint8Array): string[] {
  if (!bytes) return [];
  const doc = parser.parse(new TextDecoder().decode(bytes));
  return arr(doc?.sst?.si).map((si) => {
    if (si?.t != null) return textoDe(si.t);
    // Texto com formatação vem quebrado em <r><t>…</t></r>.
    return arr(si?.r)
      .map((r) => textoDe(r?.t))
      .join("");
  });
}

function valorCelula(c: unknown, compartilhadas: string[]): string {
  const cel = c as Record<string, unknown>;
  const tipo = cel?.["@_t"];
  if (tipo === "s") {
    const i = Number(textoDe(cel?.v));
    return compartilhadas[i] ?? "";
  }
  if (tipo === "inlineStr") {
    const is = cel?.is as Record<string, unknown> | undefined;
    if (is?.t != null) return textoDe(is.t);
    return arr(is?.r)
      .map((r) => textoDe(r?.t))
      .join("");
  }
  if (tipo === "e") return ""; // #N/D, #VALOR! …
  return textoDe(cel?.v);
}

function textoDe(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return String(o["#text"] ?? "");
  }
  return String(v);
}

/** Nó do XML pode vir único ou em lista — o parser não normaliza isso. */
function arr(v: unknown): Record<string, unknown>[] {
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]) as Record<string, unknown>[];
}

/** "BC12" → 54. Índice zero-based da coluna. */
function colunaParaIndice(ref: string): number {
  const letras = ref.replace(/[^A-Z]/g, "");
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

// ── Matriz → linhas com cabeçalho ───────────────────────────

/**
 * Cabeçalho = primeira linha com ao menos duas células preenchidas. Tabela de
 * fornecedor quase sempre começa com título e logo antes disso.
 */
export function matrizParaLinhas(matriz: Celula[][]): {
  cabecalhos: string[];
  linhas: Linha[];
} {
  const iCabecalho = matriz.findIndex(
    (l) => l.filter((c) => (c ?? "").toString().trim() !== "").length >= 2,
  );
  if (iCabecalho === -1) return { cabecalhos: [], linhas: [] };

  const cabecalhos = matriz[iCabecalho].map((c, i) => {
    const t = (c ?? "").toString().trim();
    return t === "" ? `coluna_${i + 1}` : t;
  });

  const linhas: Linha[] = [];
  for (let i = iCabecalho + 1; i < matriz.length; i++) {
    const bruta = matriz[i] ?? [];
    if (bruta.every((c) => (c ?? "").toString().trim() === "")) continue;
    const linha: Linha = {};
    cabecalhos.forEach((h, j) => {
      linha[h] = bruta[j] ?? "";
    });
    linhas.push(linha);
  }
  return { cabecalhos, linhas };
}
