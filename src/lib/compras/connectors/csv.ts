import Papa from "papaparse";
import { ConectorError, type ConectorFornecedor, type Fonte } from "../types";
import { detectarColunas, linhasParaOfertas, type Linha } from "../tabela";

/**
 * CSV/TXT. Delimitador é detectado pelo papaparse — fornecedor brasileiro
 * manda ponto e vírgula tanto quanto vírgula.
 */
export const csvConnector: ConectorFornecedor = {
  kind: "CSV",
  rotulo: "CSV",
  extensoes: [".csv", ".txt"],

  async ler(fonte: Fonte, ctx) {
    if (fonte.tipo !== "arquivo") throw new ConectorError("O conector CSV espera um arquivo.");

    const texto = decodificar(fonte.bytes);
    const parsed = Papa.parse<Linha>(texto, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
    });

    const cabecalhos = parsed.meta.fields ?? [];
    if (cabecalhos.length === 0) throw new ConectorError("CSV sem cabeçalho reconhecível.");

    const mapa = detectarColunas(cabecalhos, ctx.mapeamento);
    const resultado = linhasParaOfertas(parsed.data, mapa);

    if (parsed.errors.length > 0) {
      resultado.avisos.push(`${parsed.errors.length} linha(s) com formato inválido.`);
    }
    return resultado;
  },
};

/**
 * Planilha exportada do Windows costuma vir em latin1; JSON e export moderno
 * vêm em UTF-8. Decodifica como UTF-8 e cai para latin1 quando o resultado tem
 * caractere de substituição — acento quebrado estraga a busca por descrição.
 */
export function decodificar(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (!utf8.includes("�")) return utf8.replace(/^﻿/, "");
  return new TextDecoder("windows-1252").decode(bytes).replace(/^﻿/, "");
}
