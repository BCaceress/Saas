import type { SupplierIntegrationKind } from "@/generated/prisma";
import { ConectorError, type ConectorFornecedor, type Fonte } from "../types";
import { csvConnector } from "./csv";
import { planilhaConnector } from "./planilha";
import { jsonConnector } from "./json";
import { xmlConnector } from "./xml";
import { pdfConnector, imagemConnector } from "./documento";
import { apiConnector } from "./api";

// ============================================================
// Registro de conectores (Strategy). Adicionar origem nova = criar o arquivo,
// registrar aqui e pronto: ingest, comparador, carrinho e telas continuam
// iguais, porque todos falam o mesmo `OfertaBruta`.
// ============================================================

/** Digitação na tela: já chega no formato interno, só repassa. */
const manualConnector: ConectorFornecedor = {
  kind: "MANUAL",
  rotulo: "Manual",
  extensoes: [],
  async ler(fonte: Fonte) {
    if (fonte.tipo !== "manual") throw new ConectorError("O conector manual espera ofertas digitadas.");
    return { ofertas: fonte.ofertas, totalLinhas: fonte.ofertas.length, avisos: [] };
  },
};

const CONECTORES: Record<SupplierIntegrationKind, ConectorFornecedor> = {
  API: apiConnector,
  PLANILHA: planilhaConnector,
  CSV: csvConnector,
  PDF: pdfConnector,
  IMAGEM: imagemConnector,
  XML: xmlConnector,
  JSON: jsonConnector,
  MANUAL: manualConnector,
};

export function getConector(kind: SupplierIntegrationKind): ConectorFornecedor {
  const conector = CONECTORES[kind];
  if (!conector) throw new ConectorError(`Origem "${kind}" sem conector registrado.`);
  return conector;
}

export function conectores(): ConectorFornecedor[] {
  return Object.values(CONECTORES);
}

/** Extensões aceitas no seletor de arquivo da tela de importação. */
export const EXTENSOES_ACEITAS = [
  ...new Set(conectores().flatMap((c) => c.extensoes)),
];

/** Descobre a origem pelo arquivo — o operador não deveria ter que escolher. */
export function kindPorArquivo(nome: string, mimeType?: string): SupplierIntegrationKind | null {
  const ext = "." + (nome.split(".").pop() ?? "").toLowerCase();
  const porExtensao = conectores().find((c) => c.extensoes.includes(ext));
  if (porExtensao) return porExtensao.kind;

  if (mimeType?.startsWith("image/")) return "IMAGEM";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType?.includes("spreadsheet")) return "PLANILHA";
  if (mimeType?.includes("csv")) return "CSV";
  if (mimeType?.includes("json")) return "JSON";
  if (mimeType?.includes("xml")) return "XML";
  return null;
}
