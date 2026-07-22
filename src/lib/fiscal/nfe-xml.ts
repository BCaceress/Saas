import "server-only";
import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";

// ============================================================
// Leitor de XML de NF-e/NFC-e (layout 4.00).
//
// Lê SÓ o que a entrada de mercadoria precisa: emitente, itens, valores e
// chave. Nada de imposto detalhado — o NoHub não apura tributo (ver CLAUDE.md);
// ICMS-ST, IPI e frete entram porque compõem o CUSTO da mercadoria, não porque
// vamos declarar alguma coisa.
//
// O XML pode chegar como `nfeProc` (nota autorizada, com protocolo) ou como
// `NFe` solta (ainda não autorizada). Os dois caminhos são aceitos.
// ============================================================

export type ItemNotaXml = {
  ordem: number;
  codigoFornecedor: string;
  gtin: string | null;
  descricao: string;
  ncm: string | null;
  cfop: string | null;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  valorDesconto: number;
  valorIcmsSt: number;
  valorIpi: number;
  valorFrete: number;
  /** CFOP de bonificação/brinde/amostra: entra no estoque com custo zero. */
  bonificacao: boolean;
};

export type NotaXml = {
  chave: string;
  modelo: string;
  numero: number;
  serie: number;
  dataEmissao: Date;
  valorTotal: number;
  emitente: {
    cnpj: string;
    razaoSocial: string;
    nomeFantasia: string | null;
    ie: string | null;
    uf: string | null;
    municipio: string | null;
    codigoMunicipio: string | null;
    cep: string | null;
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    telefone: string | null;
  };
  /** CNPJ do destinatário — usado para conferir se a nota é mesmo nossa. */
  destinatarioCnpj: string | null;
  itens: ItemNotaXml[];
};

export class XmlInvalidoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "XmlInvalidoError";
  }
}

/**
 * CFOPs de entrada sem custo. Bonificação, brinde e amostra entram no estoque
 * mas não podem puxar o custo médio para baixo — quem paga a conta é o
 * fornecedor. (5910/6910 bonificação-brinde, 5911/6911 amostra grátis.)
 */
const CFOP_SEM_CUSTO = new Set(["5910", "6910", "5911", "6911", "1910", "2910", "1911", "2911"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false, // tudo string: chave/CNPJ com zero à esquerda não pode virar número
  parseAttributeValue: false,
  trimValues: true,
  removeNSPrefix: true,
});

const num = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};
const digits = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

/** fast-xml-parser devolve objeto quando há 1 ocorrência e array quando há N. */
function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

type Qualquer = Record<string, unknown>;

/** GTIN só vale se for numérico com 8/12/13/14 dígitos — "SEM GTIN" é comum. */
function gtinValido(v: unknown): string | null {
  const d = digits(v);
  return [8, 12, 13, 14].includes(d.length) ? d : null;
}

export function parseNotaXml(xml: string): NotaXml {
  let raiz: Qualquer;
  try {
    raiz = parser.parse(xml) as Qualquer;
  } catch {
    throw new XmlInvalidoError("Arquivo não é um XML válido.");
  }

  const proc = raiz.nfeProc as Qualquer | undefined;
  const nfe = (proc?.NFe ?? raiz.NFe) as Qualquer | undefined;
  const inf = nfe?.infNFe as Qualquer | undefined;
  if (!inf) {
    throw new XmlInvalidoError(
      "XML sem NF-e. Envie o arquivo da nota (nfeProc/NFe), não o do evento ou do recibo.",
    );
  }

  // Id vem como "NFe43250612345678000190550010000012341000012348".
  const chave = digits((inf["@_Id"] as string) ?? "");
  if (chave.length !== 44) {
    throw new XmlInvalidoError("XML sem chave de acesso de 44 dígitos.");
  }

  const ide = (inf.ide ?? {}) as Qualquer;
  const emit = (inf.emit ?? {}) as Qualquer;
  const ender = (emit.enderEmit ?? {}) as Qualquer;
  const dest = (inf.dest ?? {}) as Qualquer;
  const total = ((inf.total as Qualquer)?.ICMSTot ?? {}) as Qualquer;

  // dhEmi (4.00, com fuso) ou dEmi (layouts antigos, só a data).
  const dataBruta = String(ide.dhEmi ?? ide.dEmi ?? "");
  const dataEmissao = new Date(dataBruta);
  if (Number.isNaN(dataEmissao.getTime())) {
    throw new XmlInvalidoError("XML sem data de emissão legível.");
  }

  const itens = asArray(inf.det as Qualquer | Qualquer[]).map((det, i): ItemNotaXml => {
    const prod = (det.prod ?? {}) as Qualquer;
    const imposto = (det.imposto ?? {}) as Qualquer;

    // ICMS-ST e IPI podem estar em qualquer variação do grupo (ICMS10, ICMS60,
    // IPITrib…). Varremos os filhos em vez de adivinhar a combinação.
    let valorIcmsSt = 0;
    for (const grupo of Object.values((imposto.ICMS ?? {}) as Qualquer)) {
      const g = grupo as Qualquer;
      valorIcmsSt += num(g?.vICMSST);
    }
    let valorIpi = 0;
    for (const grupo of Object.values((imposto.IPI ?? {}) as Qualquer)) {
      const g = grupo as Qualquer;
      valorIpi += num(g?.vIPI);
    }

    const cfop = str(prod.CFOP);
    const ordem = Number(det["@_nItem"] ?? i + 1) || i + 1;

    return {
      ordem,
      codigoFornecedor: String(prod.cProd ?? `ITEM-${ordem}`).trim(),
      gtin: gtinValido(prod.cEAN) ?? gtinValido(prod.cEANTrib),
      descricao: String(prod.xProd ?? "").trim() || `Item ${ordem}`,
      ncm: str(prod.NCM),
      cfop,
      unidade: String(prod.uCom ?? "UN").trim().toUpperCase(),
      quantidade: num(prod.qCom),
      valorUnitario: num(prod.vUnCom),
      valorTotal: num(prod.vProd),
      valorDesconto: num(prod.vDesc),
      valorIcmsSt,
      valorIpi,
      valorFrete: num(prod.vFrete) + num(prod.vOutro),
      bonificacao: cfop ? CFOP_SEM_CUSTO.has(cfop) : false,
    };
  });

  if (itens.length === 0) {
    throw new XmlInvalidoError("A nota não tem itens.");
  }

  return {
    chave,
    modelo: String(ide.mod ?? "55"),
    numero: Number(ide.nNF ?? 0),
    serie: Number(ide.serie ?? 0),
    dataEmissao,
    valorTotal: num(total.vNF),
    emitente: {
      cnpj: digits(emit.CNPJ ?? emit.CPF),
      razaoSocial: String(emit.xNome ?? "").trim() || "Fornecedor sem nome no XML",
      nomeFantasia: str(emit.xFant),
      ie: str(emit.IE),
      uf: str(ender.UF),
      municipio: str(ender.xMun),
      codigoMunicipio: str(ender.cMun),
      cep: str(ender.CEP) ? digits(ender.CEP) : null,
      logradouro: str(ender.xLgr),
      numero: str(ender.nro),
      complemento: str(ender.xCpl),
      bairro: str(ender.xBairro),
      telefone: str(ender.fone) ? digits(ender.fone) : null,
    },
    destinatarioCnpj: dest.CNPJ ? digits(dest.CNPJ) : null,
    itens,
  };
}

export type ArquivoXml = { nome: string; conteudo: string };

/**
 * Extrai os XMLs de um upload. Aceita um .xml solto ou um .zip com vários —
 * o contador manda o mês inteiro zipado, e pedir para descompactar arquivo por
 * arquivo seria hostil.
 *
 * Ignora silenciosamente o que não é XML dentro do ZIP (PDF do DANFE vem junto).
 */
export function extrairXmls(arquivo: Uint8Array, nome: string): ArquivoXml[] {
  const ehZip = arquivo[0] === 0x50 && arquivo[1] === 0x4b; // "PK"

  if (!ehZip) {
    return [{ nome, conteudo: new TextDecoder("utf-8").decode(arquivo) }];
  }

  let entradas: Record<string, Uint8Array>;
  try {
    entradas = unzipSync(arquivo);
  } catch {
    throw new XmlInvalidoError("Não foi possível abrir o ZIP. Ele pode estar corrompido.");
  }

  const xmls = Object.entries(entradas)
    .filter(([caminho]) => caminho.toLowerCase().endsWith(".xml"))
    .map(([caminho, bytes]) => ({
      nome: caminho.split("/").pop() ?? caminho,
      conteudo: new TextDecoder("utf-8").decode(bytes),
    }));

  if (xmls.length === 0) {
    throw new XmlInvalidoError("O ZIP não tem nenhum arquivo .xml dentro.");
  }
  return xmls;
}
