import "server-only";
import https from "node:https";
import { SignedXml } from "xml-crypto";
import { XMLParser } from "fast-xml-parser";
import { FiscalProviderError, type ResultadoEvento } from "./types";
import { abrirCertificadoA1, credenciaisTls } from "./certificado-a1";

const NS_NFE = "http://www.portalfiscal.inf.br/nfe";
const SOAP_ACTION =
  "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento";
const SOAP_NAMESPACE = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4";
const ENDPOINTS = {
  PRODUCAO: "https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
  HOMOLOGACAO: "https://hom.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
} as const;

type XmlObject = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
  removeNSPrefix: true,
});

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

function iso8601Br(date: Date): string {
  const local = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return `${local.toISOString().slice(0, 19)}-03:00`;
}

function eventoXml(input: {
  cnpj: string;
  chave: string;
  tpAmb: "1" | "2";
  tipo: "CIENCIA" | "CONFIRMACAO" | "DESCONHECIMENTO" | "NAO_REALIZADA";
  justificativa?: string;
}): string {
  const eventos = {
    CIENCIA: { codigo: "210210", descricao: "Ciencia da Operacao" },
    CONFIRMACAO: { codigo: "210200", descricao: "Confirmacao da Operacao" },
    DESCONHECIMENTO: { codigo: "210220", descricao: "Desconhecimento da Operacao" },
    NAO_REALIZADA: { codigo: "210240", descricao: "Operacao nao Realizada" },
  } as const;
  const evento = eventos[input.tipo];
  const id = `ID${evento.codigo}${input.chave}01`;
  const justificativa =
    input.tipo === "DESCONHECIMENTO" || input.tipo === "NAO_REALIZADA"
      ? `<xJust>${escapeXml(input.justificativa ?? "")}</xJust>`
      : "";

  return `<envEvento xmlns="${NS_NFE}" versao="1.00">
  <idLote>${String(Date.now()).slice(-15).padStart(15, "0")}</idLote>
  <evento versao="1.00">
    <infEvento Id="${id}">
      <cOrgao>91</cOrgao>
      <tpAmb>${input.tpAmb}</tpAmb>
      <CNPJ>${input.cnpj}</CNPJ>
      <chNFe>${input.chave}</chNFe>
      <dhEvento>${iso8601Br(new Date())}</dhEvento>
      <tpEvento>${evento.codigo}</tpEvento>
      <nSeqEvento>1</nSeqEvento>
      <verEvento>1.00</verEvento>
      <detEvento versao="1.00">
        <descEvento>${evento.descricao}</descEvento>
        ${justificativa}
      </detEvento>
    </infEvento>
  </evento>
</envEvento>`;
}

function assinar(xml: string, pfxBase64: string, senha: string): string {
  const chaves = abrirCertificadoA1(pfxBase64, senha);
  const assinatura = new SignedXml({
    privateKey: chaves.privateKey,
    publicCert: chaves.certificate,
    signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });
  assinatura.idAttributes = ["Id"];
  assinatura.addReference({
    xpath: "//*[local-name(.)='infEvento']",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
    digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
  });
  assinatura.computeSignature(xml, {
    location: { reference: "//*[local-name(.)='infEvento']", action: "append" },
  });
  return assinatura.getSignedXml();
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

function mensagemRetorno(xml: string): ResultadoEvento {
  let parsed: XmlObject;
  try {
    parsed = parser.parse(xml) as XmlObject;
  } catch {
    throw new FiscalProviderError("A SEFAZ devolveu uma resposta inválida para o evento.");
  }

  const envelope = (parsed.Envelope ?? {}) as XmlObject;
  const body = (envelope.Body ?? {}) as XmlObject;
  const resposta = (body.nfeRecepcaoEventoResponse ?? {}) as XmlObject;
  const result = (resposta.nfeRecepcaoEventoResult ?? {}) as XmlObject;
  const ret = (result.retEnvEvento ?? {}) as XmlObject;
  const retEvento = (ret.retEvento ?? {}) as XmlObject;
  const infEvento = (retEvento.infEvento ?? {}) as XmlObject;
  const codigo = String(retEvento.cStat ?? ret.cStat ?? "").trim() || null;
  const mensagem = String(retEvento.xMotivo ?? ret.xMotivo ?? "").trim() || null;
  const aceito = ["135", "136", "155"].includes(codigo ?? "");

  return {
    aceito,
    codigo,
    mensagem,
    protocolo: String(infEvento.nProt ?? "").trim() || null,
    dataEvento: new Date(),
    payload: { cStat: ret.cStat, xMotivo: ret.xMotivo },
  };
}

export async function manifestarDistribuicaoSefaz(input: {
  ambiente: "PRODUCAO" | "HOMOLOGACAO";
  cnpj: string;
  chave: string;
  pfxBase64: string;
  senha: string;
  tipo: "CIENCIA" | "CONFIRMACAO" | "DESCONHECIMENTO" | "NAO_REALIZADA";
  justificativa?: string;
}): Promise<ResultadoEvento> {
  const tpAmb = input.ambiente === "PRODUCAO" ? "1" : "2";
  const assinado = assinar(eventoXml({ ...input, tpAmb }), input.pfxBase64, input.senha);
  const soap = `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeRecepcaoEvento xmlns="${SOAP_NAMESPACE}">
      <nfeDadosMsg>${assinado}</nfeDadosMsg>
    </nfeRecepcaoEvento>
  </soap12:Body>
</soap12:Envelope>`;

  const resposta = await postSoap(
    ENDPOINTS[input.ambiente],
    soap,
    credenciaisTls(input.pfxBase64, input.senha),
  );
  return mensagemRetorno(resposta);
}
