import "server-only";
import { XMLParser } from "fast-xml-parser";
import { XmlInvalidoError } from "./nfe-xml";

// ============================================================
// Leitor de CT-e (modelo 57) — o frete que vem em documento separado.
//
// Antes o CT-e era recusado com uma mensagem educada, e o valor sumia. Mas o
// frete que o transportador cobra É custo da mercadoria: quem paga R$ 180 de
// entrega numa carga de R$ 3.000 tem margem 6% menor do que o sistema mostra.
//
// O CT-e traz a lista de chaves das NF-e que ele transportou (`infNFe/chave`).
// É por aí que o valor volta para o custo: rateado entre as notas daquela
// carga, proporcional ao valor de cada uma.
//
// Lemos só o necessário: chave, emitente, valor e as notas transportadas.
// Nada de imposto — o NoHub não apura (ver CLAUDE.md).
// ============================================================

export type CteXml = {
  chave: string;
  modelo: string;
  numero: number;
  serie: number;
  dataEmissao: Date;
  /** vRec (valor a receber) ou vTPrest (valor total da prestação). */
  valorTotal: number;
  emitente: {
    cnpj: string;
    razaoSocial: string;
    uf: string | null;
  };
  /** CNPJ de quem paga o frete (tomador) — confere se é mesmo nosso. */
  tomadorCnpj: string | null;
  /** Chaves de 44 dígitos das NF-e transportadas. */
  notasTransportadas: string[];
  /** CIF (0 = por conta do emitente) ou FOB (1 = por conta do destinatário). */
  tipoFrete: string | null;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  removeNSPrefix: true,
});

type Qualquer = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};
const digits = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

/**
 * Colhe toda chave de 44 dígitos que apareça sob `infDoc`. O layout varia entre
 * versões (infNFe, infNF, infOutros) e entre emissores; procurar pela FORMA da
 * chave é mais robusto do que perseguir o caminho exato de cada uma.
 */
function colherChaves(no: unknown, achadas: Set<string>): void {
  if (no == null) return;
  if (typeof no === "string") {
    const d = digits(no);
    if (d.length === 44) achadas.add(d);
    return;
  }
  if (Array.isArray(no)) {
    for (const item of no) colherChaves(item, achadas);
    return;
  }
  if (typeof no === "object") {
    for (const valor of Object.values(no as Qualquer)) colherChaves(valor, achadas);
  }
}

export function parseCteXml(xml: string): CteXml {
  let raiz: Qualquer;
  try {
    raiz = parser.parse(xml) as Qualquer;
  } catch {
    throw new XmlInvalidoError("Arquivo não é um XML válido.");
  }

  const proc = raiz.cteProc as Qualquer | undefined;
  const cte = (proc?.CTe ?? raiz.CTe) as Qualquer | undefined;
  const inf = (cte?.infCte ?? cte?.infCTe) as Qualquer | undefined;
  if (!inf) {
    throw new XmlInvalidoError("XML sem CT-e. Envie o arquivo do conhecimento de transporte.");
  }

  const chave = digits((inf["@_Id"] as string) ?? "");
  if (chave.length !== 44) {
    throw new XmlInvalidoError("CT-e sem chave de acesso de 44 dígitos.");
  }

  const ide = (inf.ide ?? {}) as Qualquer;
  const emit = (inf.emit ?? {}) as Qualquer;
  const ender = (emit.enderEmit ?? {}) as Qualquer;
  const vPrest = (inf.vPrest ?? {}) as Qualquer;

  const dataBruta = String(ide.dhEmi ?? ide.dEmi ?? "");
  const dataEmissao = new Date(dataBruta);
  if (Number.isNaN(dataEmissao.getTime())) {
    throw new XmlInvalidoError("CT-e sem data de emissão legível.");
  }

  // O valor a cobrar é `vRec`; `vTPrest` é o total da prestação. Quando os dois
  // existem e divergem, o que entra no custo é o que vai ser pago.
  const valorTotal = num(vPrest.vRec) || num(vPrest.vTPrest);

  const chaves = new Set<string>();
  colherChaves(inf.infCTeNorm ?? inf.infCteNorm, chaves);
  // Fallback: alguns emissores penduram `infDoc` direto na raiz de infCte.
  if (chaves.size === 0) colherChaves((inf as Qualquer).infDoc, chaves);
  // A própria chave do CT-e não é uma nota transportada.
  chaves.delete(chave);

  // Tomador pode vir como grupo (`toma3`/`toma4`) ou como índice. Só o CNPJ
  // interessa: é o que responde "esse frete é meu?".
  const toma4 = (inf.toma4 ?? inf.toma3 ?? {}) as Qualquer;
  const dest = (inf.dest ?? {}) as Qualquer;
  const tomadorCnpj = toma4.CNPJ ? digits(toma4.CNPJ) : dest.CNPJ ? digits(dest.CNPJ) : null;

  return {
    chave,
    modelo: String(ide.mod ?? "57"),
    numero: Number(ide.nCT ?? 0),
    serie: Number(ide.serie ?? 0),
    dataEmissao,
    valorTotal,
    emitente: {
      cnpj: digits(emit.CNPJ ?? emit.CPF),
      razaoSocial: String(emit.xNome ?? "").trim() || "Transportadora sem nome no XML",
      uf: str(ender.UF),
    },
    tomadorCnpj,
    notasTransportadas: [...chaves],
    tipoFrete: str(ide.tpServ),
  };
}

/**
 * Rateia o frete entre as notas transportadas, proporcional ao valor de cada
 * uma. Carga com uma nota de R$ 3.000 e outra de R$ 1.000 divide 75/25 — não
 * meio a meio, que é o que "dividir igual" faria com a margem do produto caro.
 */
export function ratearFrete(
  valorFrete: number,
  notas: { chave: string; valorTotal: number }[],
): Map<string, number> {
  const saida = new Map<string, number>();
  if (valorFrete <= 0 || notas.length === 0) return saida;

  const total = notas.reduce((a, n) => a + n.valorTotal, 0);

  // Sem valor em nenhuma nota, divide igual — é o único critério honesto.
  if (total <= 0) {
    const parte = valorFrete / notas.length;
    for (const nota of notas) saida.set(nota.chave, arredondar(parte));
    return saida;
  }

  let distribuido = 0;
  notas.forEach((nota, i) => {
    // A última linha leva a sobra do arredondamento: sem isso a soma das partes
    // não bate com o frete, e a diferença aparece como centavo perdido no custo.
    const parte =
      i === notas.length - 1
        ? arredondar(valorFrete - distribuido)
        : arredondar((valorFrete * nota.valorTotal) / total);
    saida.set(nota.chave, parte);
    distribuido += parte;
  });

  return saida;
}

const arredondar = (v: number) => Math.round(v * 100) / 100;

/** O XML é de CT-e? Decide o leitor antes de qualquer parse. */
export function ehCteXml(xml: string): boolean {
  return /<(\w+:)?(cteProc|CTe)\b/.test(xml);
}
