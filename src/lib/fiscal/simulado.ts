import "server-only";
import type {
  ArquivoFiscal,
  CertificadoInfo,
  FiscalProvider,
  ResultadoEvento,
  ResultadoFiscal,
  DocumentoParaEmitir,
} from "./types";

// ============================================================
// Provedor SIMULADO — desenvolvimento e demonstração sem certificado, sem
// contrato com provedor e sem SEFAZ. Espelha o simulado de lib/pagamentos.
//
// Sem estado: o timestamp vai embutido no externalId e o documento "autoriza
// sozinho" depois de alguns segundos — é o que exercita o polling do PDV.
//
// Rejeita de propósito quando o documento tem erro estrutural óbvio (item sem
// NCM, total divergente). Se o simulado autorizasse tudo, o caminho de
// rejeição só apareceria em produção — que é exatamente onde não se testa.
// ============================================================

const AUTORIZA_MS = 3_000;

/** Chave de 44 dígitos plausível, só para exercitar a UI. */
function chaveFake(doc: DocumentoParaEmitir): string {
  const uf = "43";
  const aamm =
    String(doc.dataEmissao.getFullYear()).slice(2) +
    String(doc.dataEmissao.getMonth() + 1).padStart(2, "0");
  const cnpj = doc.emitente.cnpj.padStart(14, "0").slice(0, 14);
  const mod = doc.modelo === "NFCE" ? "65" : "55";
  const serie = String(doc.serie).padStart(3, "0");
  const numero = String(doc.numero).padStart(9, "0");
  const resto = String(Date.now()).slice(-9).padStart(9, "0");
  const base = `${uf}${aamm}${cnpj}${mod}${serie}${numero}1${resto}`.slice(0, 43);
  return `${base}0`;
}

type Motivo = { codigo: string; mensagem: string };

/** Validações que a SEFAZ faria — dá para bater nelas antes de ter conta. */
function criticar(doc: DocumentoParaEmitir): Motivo | null {
  if (doc.itens.length === 0) {
    return { codigo: "225", mensagem: "Rejeição: Falha no Schema XML — nota sem itens." };
  }
  const semNcm = doc.itens.find((i) => !i.ncm || i.ncm.length !== 8);
  if (semNcm) {
    return {
      codigo: "778",
      mensagem: `Rejeição: NCM inválido ou ausente no item ${semNcm.ordem} (${semNcm.descricao}).`,
    };
  }
  const semCfop = doc.itens.find((i) => !i.cfop);
  if (semCfop) {
    return {
      codigo: "527",
      mensagem: `Rejeição: CFOP ausente no item ${semCfop.ordem} (${semCfop.descricao}).`,
    };
  }
  const somaItens = doc.itens.reduce((s, i) => s + i.valorTotal - i.valorDesconto, 0);
  if (Math.abs(somaItens - doc.valorTotal) > 0.01) {
    return {
      codigo: "533",
      mensagem: "Rejeição: Total da nota difere do somatório dos itens.",
    };
  }
  const somaPagamentos = doc.pagamentos.reduce((s, p) => s + p.valor, 0);
  if (doc.pagamentos.length > 0 && somaPagamentos + 0.01 < doc.valorTotal) {
    return {
      codigo: "888",
      mensagem: "Rejeição: Somatório dos pagamentos menor que o total da nota.",
    };
  }
  if (doc.modelo === "NFE" && !doc.destinatario?.documento) {
    return { codigo: "237", mensagem: "Rejeição: NF-e exige destinatário identificado." };
  }
  return null;
}

function rejeitado(m: Motivo, externalId: string): ResultadoFiscal {
  return {
    status: "REJEITADO",
    externalId,
    chave: null,
    protocolo: null,
    dataAutorizacao: null,
    codigo: m.codigo,
    mensagem: m.mensagem,
    qrCodeUrl: null,
    urlConsulta: null,
  };
}

function emitir(doc: DocumentoParaEmitir): ResultadoFiscal {
  const externalId = `sim_${doc.modelo.toLowerCase()}_${Date.now()}`;
  const critica = criticar(doc);
  if (critica) return rejeitado(critica, externalId);

  const chave = chaveFake(doc);
  return {
    status: doc.contingencia ? "CONTINGENCIA" : "PROCESSANDO",
    externalId,
    chave,
    protocolo: null,
    dataAutorizacao: null,
    codigo: null,
    mensagem: null,
    qrCodeUrl: `https://simulado.nohub.local/qr?chave=${chave}`,
    urlConsulta: `https://simulado.nohub.local/consulta?chave=${chave}`,
  };
}

export function fiscalSimuladoProvider(): FiscalProvider {
  const evento = (mensagem: string): ResultadoEvento => ({
    aceito: true,
    protocolo: `sim_prot_${Date.now()}`,
    codigo: "135",
    mensagem,
    dataEvento: new Date(),
  });

  const arquivo = (nome: string, tipo: string, corpo: string): ArquivoFiscal => ({
    conteudo: new TextEncoder().encode(corpo),
    contentType: tipo,
    nomeSugerido: nome,
  });

  const certificado = (cnpj: string): CertificadoInfo => ({
    id: `sim_cert_${cnpj}`,
    titular: "CERTIFICADO SIMULADO (desenvolvimento)",
    cnpj,
    // Perto o bastante para exercitar o aviso de vencimento na tela.
    validade: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
  });

  return {
    slug: "SIMULADO",

    async validarCredenciais() {},

    async enviarCertificado({ cnpj }) {
      return certificado(cnpj);
    },
    async validarCertificado(cnpj) {
      return certificado(cnpj);
    },

    async emitirNFCe(doc) {
      return emitir(doc);
    },
    async emitirNFe(doc) {
      return emitir(doc);
    },

    async consultarNota({ externalId }) {
      const ts = Number(externalId.split("_").pop());
      const autorizado = Number.isFinite(ts) && Date.now() - ts >= AUTORIZA_MS;
      return {
        status: autorizado ? "AUTORIZADO" : "PROCESSANDO",
        externalId,
        chave: null,
        protocolo: autorizado ? `sim_prot_${ts}` : null,
        dataAutorizacao: autorizado ? new Date(ts + AUTORIZA_MS) : null,
        codigo: autorizado ? "100" : null,
        mensagem: autorizado ? "Autorizado o uso da NF-e" : null,
        qrCodeUrl: null,
        urlConsulta: null,
      };
    },

    async cancelarNota() {
      return evento("Evento registrado e vinculado a NF-e (cancelamento simulado)");
    },
    async cartaCorrecao() {
      return evento("Evento registrado e vinculado a NF-e (CC-e simulada)");
    },
    async inutilizar() {
      return evento("Inutilização de número homologada (simulada)");
    },
    async manifestar() {
      return evento("Evento registrado e vinculado a NF-e (manifestação simulada)");
    },

    async baixarXML({ externalId }) {
      return arquivo(
        `${externalId}.xml`,
        "application/xml",
        `<?xml version="1.0" encoding="UTF-8"?>\n<nfeProc simulado="true" id="${externalId}" />`,
      );
    },
    async baixarPDF({ externalId }) {
      // PDF de verdade só no adapter real; aqui um texto basta para o fluxo.
      return arquivo(`${externalId}.txt`, "text/plain", `DANFE SIMULADA — ${externalId}`);
    },
  };
}
