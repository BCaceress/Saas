import "server-only";
import https from "node:https";
import { gunzipSync } from "node:zlib";
import { XMLParser } from "fast-xml-parser";
import { FiscalProviderError } from "./types";
import { credenciaisTls } from "./certificado-a1";

const NS_NFE = "http://www.portalfiscal.inf.br/nfe";
const SOAP_ACTION =
  "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse";
const SOAP_NAMESPACE = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe";
const ENDPOINTS = {
  PRODUCAO: "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
  HOMOLOGACAO: "https://hom.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
} as const;

const UF_IBGE: Record<string, string> = {
  AC: "12",
  AL: "27",
  AP: "16",
  AM: "13",
  BA: "29",
  CE: "23",
  DF: "53",
  ES: "32",
  GO: "52",
  MA: "21",
  MT: "51",
  MS: "50",
  MG: "31",
  PA: "15",
  PB: "25",
  PR: "41",
  PE: "26",
  PI: "22",
  RJ: "33",
  RN: "24",
  RS: "43",
  RO: "11",
  RR: "14",
  SC: "42",
  SP: "35",
  SE: "28",
  TO: "17",
};

type XmlObject = Record<string, unknown>;

/**
 * Nota de fornecedor só existe em produção — a homologação da SEFAZ só tem
 * notas de teste. Por isso o ambiente da distribuição NÃO segue o da emissão
 * (FiscalConfig nasce em homologação): `SEFAZ_DISTRIBUICAO_AMBIENTE` só para
 * desenvolvimento.
 */
export function ambienteDistribuicao(): "PRODUCAO" | "HOMOLOGACAO" {
  return process.env.SEFAZ_DISTRIBUICAO_AMBIENTE === "HOMOLOGACAO" ? "HOMOLOGACAO" : "PRODUCAO";
}

export type DocumentoSefaz = {
  nsu: bigint;
  schema: string;
  chave: string;
  resumo: boolean;
  emitCnpj: string;
  emitRazaoSocial: string;
  valorTotal: number | null;
  dataEmissao: Date | null;
  xml: string;
};

export type ResultadoDistribuicaoSefaz = {
  cStat: string;
  xMotivo: string;
  ultNSU: bigint;
  maxNSU: bigint;
  documentos: DocumentoSefaz[];
  /** docZip que não é nota (eventos, CT-e…), por schema — só para diagnóstico. */
  ignorados: Record<string, number>;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
  removeNSPrefix: true,
});

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function numberOrNull(value: unknown): number | null {
  const n = Number(text(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function dateOrNull(value: unknown): Date | null {
  const date = new Date(text(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function bigintOrZero(value: unknown): bigint {
  const raw = text(value);
  return /^\d+$/.test(raw) ? BigInt(raw) : BigInt(0);
}

function cnpj(value: unknown): string {
  return text(value).replace(/\D/g, "");
}

function chaveDoXml(xml: XmlObject): string {
  const res = (xml.resNFe ?? {}) as XmlObject;
  const proc = (xml.nfeProc ?? xml.procNFe ?? {}) as XmlObject;
  const nfe = (proc.NFe ?? {}) as XmlObject;
  const inf = (nfe.infNFe ?? {}) as XmlObject;
  return cnpj(res.chNFe ?? inf["@_Id"]).replace(/^NFe/, "");
}

function documentoDoZip(
  nsu: bigint,
  schema: string,
  conteudo: string,
): DocumentoSefaz | null {
  let parsed: XmlObject;
  try {
    parsed = parser.parse(conteudo) as XmlObject;
  } catch {
    throw new FiscalProviderError("A SEFAZ devolveu um documento XML inválido.");
  }

  const schemaNormalizado = schema.toLowerCase();
  const resumo = schemaNormalizado.startsWith("resnfe");
  const completo = schemaNormalizado.startsWith("procnfe");
  if (!resumo && !completo) return null;
  const res = (parsed.resNFe ?? {}) as XmlObject;
  const proc = (parsed.nfeProc ?? parsed.procNFe ?? {}) as XmlObject;
  const nfe = (proc.NFe ?? {}) as XmlObject;
  const inf = (nfe.infNFe ?? {}) as XmlObject;
  const emit = (inf.emit ?? {}) as XmlObject;
  const ide = (inf.ide ?? {}) as XmlObject;
  const total = (inf.total ?? {}) as XmlObject;
  const icmsTot = (total.ICMSTot ?? {}) as XmlObject;
  const chave = chaveDoXml(parsed);
  if (chave.length !== 44) return null;

  return {
    nsu,
    schema,
    chave,
    resumo,
    emitCnpj: cnpj(res.CNPJ ?? res.CPFCNPJ ?? emit.CNPJ),
    emitRazaoSocial: text(res.xNome ?? emit.xNome),
    valorTotal: numberOrNull(res.vNF ?? icmsTot.vNF),
    dataEmissao: dateOrNull(res.dhEmi ?? res.dEmi ?? ide.dhEmi ?? ide.dEmi),
    xml: conteudo,
  };
}

function decodificarDocZip(value: unknown): string {
  const bytes = Buffer.from(text(value), "base64");
  try {
    return gunzipSync(bytes).toString("utf8");
  } catch {
    // Alguns ambientes homologação devolvem o XML sem compressão.
    return bytes.toString("utf8");
  }
}

function soapEnvelope(input: {
  ambiente: "PRODUCAO" | "HOMOLOGACAO";
  uf: string;
  cnpj: string;
  ultNSU: bigint;
  chaveConsulta?: string;
}): string {
  const tpAmb = input.ambiente === "PRODUCAO" ? "1" : "2";
  const cUF = UF_IBGE[input.uf.toUpperCase()];
  if (!cUF) throw new FiscalProviderError(`UF inválida para a consulta da SEFAZ: ${input.uf}.`);

  // consChNFe devolve o procNFe de uma nota já manifestada; distNSU percorre o
  // acervo pelo cursor.
  const consulta = input.chaveConsulta == null
    ? `<distNSU><ultNSU>${input.ultNSU.toString().padStart(15, "0")}</ultNSU></distNSU>`
    : `<consChNFe><chNFe>${input.chaveConsulta}</chNFe></consChNFe>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeDistDFeInteresse xmlns="${SOAP_NAMESPACE}">
      <nfeDadosMsg>
        <distDFeInt xmlns="${NS_NFE}" versao="1.01">
          <tpAmb>${tpAmb}</tpAmb>
          <cUFAutor>${cUF}</cUFAutor>
          <CNPJ>${input.cnpj}</CNPJ>
          ${consulta}
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`;
}

async function postSoap(
  endpoint: string,
  body: string,
  tls: { key: string; cert: string },
): Promise<string> {
  const url = new URL(endpoint);
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        key: tls.key,
        cert: tls.cert,
        timeout: 45_000,
        headers: {
          "content-type": `application/soap+xml; charset=utf-8; action="${SOAP_ACTION}"`,
          "content-length": Buffer.byteLength(body),
          accept: "application/soap+xml, text/xml",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const response = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) {
            reject(new FiscalProviderError(`A SEFAZ respondeu HTTP ${res.statusCode}.`));
            return;
          }
          resolve(response);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("tempo esgotado")));
    req.on("error", (error) =>
      reject(
        new FiscalProviderError(`Não foi possível conectar à SEFAZ com o certificado A1: ${error.message}`, error),
      ),
    );
    req.end(body);
  });
}

export async function consultarDistribuicaoSefaz(input: {
  ambiente: "PRODUCAO" | "HOMOLOGACAO";
  uf: string;
  cnpj: string;
  pfxBase64: string;
  senha: string;
  ultNSU: bigint;
  chaveConsulta?: string;
}): Promise<ResultadoDistribuicaoSefaz> {
  const tls = credenciaisTls(input.pfxBase64, input.senha);
  let cursor = input.ultNSU;
  let ultimo: ResultadoDistribuicaoSefaz | null = null;
  const documentos: DocumentoSefaz[] = [];
  const ignorados: Record<string, number> = {};

  // A SEFAZ limita cada lote a 50 documentos. Avançar o cursor aqui garante
  // que um CNPJ com acervo grande seja drenado numa única sincronização.
  for (let pagina = 0; pagina < 20; pagina += 1) {
    const xml = await postSoap(
      ENDPOINTS[input.ambiente],
      soapEnvelope({ ...input, ultNSU: cursor }),
      tls,
    );

    let parsed: XmlObject;
    try {
      parsed = parser.parse(xml) as XmlObject;
    } catch {
      throw new FiscalProviderError("A SEFAZ devolveu uma resposta inválida.");
    }

    const envelope = (parsed.Envelope ?? {}) as XmlObject;
    const body = (envelope.Body ?? {}) as XmlObject;
    const resposta = (body.nfeDistDFeInteresseResponse ?? {}) as XmlObject;
    const retorno = (resposta.nfeDistDFeInteresseResult ?? {}) as XmlObject;
    const ret = (retorno.retDistDFeInt ?? {}) as XmlObject;
    const cStat = text(ret.cStat);
    const xMotivo = text(ret.xMotivo);
    if (!cStat) {
      throw new FiscalProviderError("A resposta da SEFAZ não trouxe o código de status.");
    }
    if (!["137", "138"].includes(cStat)) {
      throw new FiscalProviderError(`SEFAZ ${cStat}: ${xMotivo || "consulta recusada."}`);
    }

    const lote = (ret.loteDistDFeInt ?? {}) as XmlObject;
    for (const zip of asArray(lote.docZip as XmlObject | XmlObject[] | undefined)) {
      const conteudo = decodificarDocZip(zip["#text"] ?? zip);
      const documento = documentoDoZip(
        bigintOrZero(zip["@_NSU"]),
        text(zip["@_schema"]),
        conteudo,
      );
      if (documento) {
        documentos.push(documento);
      } else {
        const schema = text(zip["@_schema"]) || "desconhecido";
        ignorados[schema] = (ignorados[schema] ?? 0) + 1;
      }
    }

    const resultado: ResultadoDistribuicaoSefaz = {
      cStat,
      xMotivo,
      ultNSU: bigintOrZero(ret.ultNSU),
      maxNSU: bigintOrZero(ret.maxNSU),
      documentos: [],
      ignorados: {},
    };
    ultimo = resultado;
    if (
      input.chaveConsulta != null ||
      resultado.ultNSU === BigInt(0) ||
      resultado.ultNSU >= resultado.maxNSU
    ) break;
    if (resultado.ultNSU <= cursor) break;
    cursor = resultado.ultNSU;
  }

  if (!ultimo) throw new FiscalProviderError("A SEFAZ não retornou nenhum lote.");
  return { ...ultimo, documentos, ignorados };
}
