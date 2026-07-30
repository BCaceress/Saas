import { XMLParser } from "fast-xml-parser";
import {
  ConectorError,
  type ConectorFornecedor,
  type Fonte,
  type MapeamentoColunas,
  type OfertaBruta,
  type ResultadoConector,
} from "../types";
import { detectarColunas, limparEan, linhasParaOfertas, parseNumero, type Linha } from "../tabela";
import { decodificar } from "./csv";

// ============================================================
// Dois XMLs diferentes chegam por aqui:
//   • NF-e / nota de fornecedor  → itens em <det><prod>, campos com nome fixo;
//   • tabela de preço em XML     → estrutura livre, cada fornecedor a sua.
// A NF-e é reconhecida pelo <infNFe> e lida por caminho conhecido; o resto cai
// no caminho genérico (acha a lista repetida e trata como tabela).
// ============================================================

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
});

export const xmlConnector: ConectorFornecedor = {
  kind: "XML",
  rotulo: "XML",
  extensoes: [".xml"],

  async ler(fonte: Fonte, ctx) {
    if (fonte.tipo !== "arquivo") throw new ConectorError("O conector XML espera um arquivo.");

    const doc = parser.parse(decodificar(fonte.bytes));
    const nfe = acharNFe(doc);
    return nfe ? lerNFe(nfe) : lerXmlGenerico(doc, ctx.mapeamento);
  },
};

// ── NF-e ────────────────────────────────────────────────────

type NoQualquer = Record<string, unknown>;

function acharNFe(doc: NoQualquer): NoQualquer | null {
  const raiz = (doc?.nfeProc as NoQualquer) ?? doc;
  const nfe = (raiz?.NFe as NoQualquer) ?? (raiz?.nfe as NoQualquer);
  const inf = nfe?.infNFe as NoQualquer | undefined;
  return inf ?? null;
}

function lerNFe(inf: NoQualquer): ResultadoConector {
  const dets = arr(inf.det);
  const ofertas: OfertaBruta[] = [];
  const avisos: string[] = [];

  for (const det of dets) {
    const prod = (det as NoQualquer)?.prod as NoQualquer | undefined;
    if (!prod) continue;

    const quantidade = parseNumero(prod.qCom) ?? 1;
    const total = parseNumero(prod.vProd) ?? 0;
    const unitario = parseNumero(prod.vUnCom) ?? (quantidade > 0 ? total / quantidade : 0);
    if (unitario <= 0) continue;

    ofertas.push({
      codigoFornecedor: texto(prod.cProd),
      ean: limparEan(prod.cEAN ?? prod.cEANTrib),
      descricao: texto(prod.xProd) ?? texto(prod.cProd) ?? "Item sem descrição",
      unidade: texto(prod.uCom),
      preco: unitario,
      precoPromocional: null,
      quantidadeMinima: null,
      estoqueDisponivel: null,
      validadeOferta: null,
    });
  }

  if (ofertas.length === 0) avisos.push("Nenhum item com preço encontrado na nota.");
  // Preço de nota é preço praticado, não tabela: entra como referência.
  avisos.push("Preços lidos de NF-e — valem como preço praticado na última compra.");

  return { ofertas, totalLinhas: dets.length, avisos };
}

// ── XML genérico ────────────────────────────────────────────

function lerXmlGenerico(doc: NoQualquer, mapeamento?: MapeamentoColunas | null): ResultadoConector {
  const lista = acharLista(doc);
  if (!lista) throw new ConectorError("Não encontrei uma lista de produtos no XML.");

  const linhas: Linha[] = lista.map((item) => achatar(item as NoQualquer));
  const cabecalhos = [...new Set(linhas.flatMap((l) => Object.keys(l)))];
  const mapa = detectarColunas(cabecalhos, mapeamento);
  return linhasParaOfertas(linhas, mapa);
}

/** Primeiro nó que se repete (2+) — é sempre a lista de itens. */
function acharLista(no: unknown, profundidade = 0): unknown[] | null {
  if (profundidade > 6 || !no || typeof no !== "object") return null;

  for (const valor of Object.values(no as NoQualquer)) {
    if (Array.isArray(valor) && valor.length > 1 && typeof valor[0] === "object") return valor;
  }
  for (const valor of Object.values(no as NoQualquer)) {
    const achado = acharLista(valor, profundidade + 1);
    if (achado) return achado;
  }
  return null;
}

function achatar(obj: NoQualquer, prefixo = ""): Linha {
  const saida: Linha = {};
  for (const [chave, valor] of Object.entries(obj ?? {})) {
    if (chave.startsWith("@_")) {
      saida[prefixo ? `${prefixo}.${chave.slice(2)}` : chave.slice(2)] = valor as unknown;
      continue;
    }
    const nome = prefixo ? `${prefixo}.${chave}` : chave;
    if (valor && typeof valor === "object" && !Array.isArray(valor)) {
      Object.assign(saida, achatar(valor as NoQualquer, nome));
    } else if (!Array.isArray(valor)) {
      saida[nome] = valor as unknown;
    }
  }
  return saida;
}

function arr<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function texto(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
