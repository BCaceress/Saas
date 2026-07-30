import { zipSync, strToU8 } from "fflate";

/**
 * Planilha .xlsx de verdade — não CSV com outro nome.
 *
 * O CSV já existe e resolve importação, mas quem pede "Excel" quer abrir com
 * duplo clique, sem diálogo de separador e com número somando na coluna. Um
 * xlsx é um zip de XMLs, e o `fflate` (já no projeto, usado pelo fiscal) faz o
 * zip — então isso sai sem dependência nova.
 *
 * Escopo deliberado: uma aba, cabeçalho em negrito, números como número e texto
 * como texto. Sem fórmula, sem gráfico, sem estilo além do necessário — quem
 * precisa disso monta no Excel a partir do arquivo.
 */

export type CelulaXlsx = string | number | null | undefined;

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function esc(texto: string): string {
  // Caracteres de controle não são válidos em XML e derrubam o Excel inteiro.
  return texto.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Coluna 1 → "A", 27 → "AA". */
function coluna(indice: number): string {
  let n = indice;
  let saida = "";
  while (n > 0) {
    const resto = (n - 1) % 26;
    saida = String.fromCharCode(65 + resto) + saida;
    n = Math.floor((n - 1) / 26);
  }
  return saida;
}

function celula(ref: string, valor: CelulaXlsx, estilo: number): string {
  if (valor === null || valor === undefined || valor === "") {
    return `<c r="${ref}" s="${estilo}"/>`;
  }
  if (typeof valor === "number" && Number.isFinite(valor)) {
    return `<c r="${ref}" s="${estilo}"><v>${valor}</v></c>`;
  }
  return `<c r="${ref}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${esc(String(valor))}</t></is></c>`;
}

function folha(cabecalho: string[], linhas: CelulaXlsx[][], rodape?: CelulaXlsx[]): string {
  const todas: { valores: CelulaXlsx[]; estilo: number }[] = [
    { valores: cabecalho, estilo: 1 },
    ...linhas.map((l) => ({ valores: l as CelulaXlsx[], estilo: 0 })),
    ...(rodape ? [{ valores: rodape, estilo: 1 }] : []),
  ];

  const xml = todas
    .map(({ valores, estilo }, i) => {
      const celulas = valores
        .map((v, j) => celula(`${coluna(j + 1)}${i + 1}`, v, estilo))
        .join("");
      return `<row r="${i + 1}">${celulas}</row>`;
    })
    .join("");

  // Largura generosa na primeira coluna: quase sempre é o nome do produto.
  const larguras = cabecalho
    .map((_, j) => `<col min="${j + 1}" max="${j + 1}" width="${j === 0 ? 42 : 16}" customWidth="1"/>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${larguras}</cols><sheetData>${xml}</sheetData></worksheet>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

/** Dois estilos: 0 = corpo, 1 = negrito (cabeçalho e linha de total). */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;

function workbook(nomeAba: string): string {
  // O Excel recusa aba com > 31 caracteres ou com : \ / ? * [ ]
  const nome = esc(nomeAba.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Relatório");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${nome}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

/** Arquivo .xlsx pronto para virar `Response`. */
export function gerarXlsx(args: {
  aba: string;
  cabecalho: string[];
  linhas: CelulaXlsx[][];
  /** Linha de total, em negrito no rodapé. */
  rodape?: CelulaXlsx[];
}): Uint8Array {
  return zipSync(
    {
      "[Content_Types].xml": strToU8(CONTENT_TYPES),
      "_rels/.rels": strToU8(RELS),
      "xl/workbook.xml": strToU8(workbook(args.aba)),
      "xl/_rels/workbook.xml.rels": strToU8(WORKBOOK_RELS),
      "xl/styles.xml": strToU8(STYLES),
      "xl/worksheets/sheet1.xml": strToU8(folha(args.cabecalho, args.linhas, args.rodape)),
    },
    { level: 6 },
  );
}

export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
