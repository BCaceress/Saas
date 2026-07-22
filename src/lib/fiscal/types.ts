import type { FiscalProviderKind, FiscalModelo } from "@/generated/prisma";

// ============================================================
// FiscalProvider — contrato do provedor de documento eletrônico.
// O ERP nunca fala com Nuvem Fiscal / PlugNotas / Focus direto: fala com esta
// interface, e o adapter traduz. Trocar de provedor = escrever outro adapter,
// sem tocar em PDV, Compras ou Estoque.
//
// Mesmo padrão de lib/pagamentos. Duas regras que não se negociam:
//   1. Nada aqui devolve XML/JSON cru do provedor como contrato — só tipos
//      normalizados. Campo específico de fornecedor vai em `payload`, que é
//      só para log/suporte.
//   2. Rejeição da SEFAZ NÃO é exceção: é um resultado (status REJEITADO com
//      código e motivo). Exceção fica para falha de transporte/credencial.
// ============================================================

/** Estado normalizado de um documento no provedor. */
export type StatusFiscal =
  | "PROCESSANDO"
  | "AUTORIZADO"
  | "REJEITADO"
  | "DENEGADO"
  | "CANCELADO"
  | "CONTINGENCIA";

export type EmitenteFiscal = {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  ie: string;
  im: string | null;
  /** CRT: 1 Simples, 2 Simples c/ excesso, 3 Normal. */
  crt: 1 | 2 | 3;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  municipio: string;
  /** Código IBGE de 7 dígitos — a SEFAZ pede o código, não o nome. */
  codigoMunicipio: string;
  uf: string;
  telefone: string | null;
  /** Id do certificado A1 guardado NO provedor (nunca a chave privada). */
  certificadoId: string | null;
  /** NFC-e: CSC e seu identificador, emitidos pela SEFAZ da UF. */
  cscId: string | null;
  csc: string | null;
};

/**
 * Destinatário. Tudo opcional porque NFC-e aceita consumidor não
 * identificado — que é o caso normal no mercadinho.
 */
export type DestinatarioFiscal = {
  documento: string | null; // CPF/CNPJ, só dígitos
  nome: string | null;
  email: string | null;
  ie: string | null;
  /** indIEDest: 1 contribuinte, 2 isento, 9 não contribuinte. */
  indicadorIE: 1 | 2 | 9 | null;
  endereco: {
    cep: string;
    logradouro: string;
    numero: string;
    complemento: string | null;
    bairro: string;
    municipio: string;
    codigoMunicipio: string;
    uf: string;
  } | null;
};

export type ItemFiscal = {
  ordem: number; // nItem, 1-based
  codigo: string; // cProd — nosso SKU
  descricao: string;
  gtin: string | null; // cEAN ("SEM GTIN" é responsabilidade do adapter)
  ncm: string;
  cest: string | null;
  cfop: string;
  origem: string; // 0..8
  /** Regime Normal usa cst; Simples usa csosn. Nunca os dois. */
  cst: string | null;
  csosn: string | null;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  valorDesconto: number;
  aliquotaIcms: number | null;
  /** Unidade tributável quando difere da de venda (venda a granel). */
  unidadeTributavel: string | null;
  quantidadeTributavel: number | null;
  codigoBeneficio: string | null;
  codigoAnp: string | null;
};

/** Forma de pagamento no documento (tPag da SEFAZ). */
export type PagamentoFiscal = {
  forma:
    | "DINHEIRO"
    | "CHEQUE"
    | "CARTAO_CREDITO"
    | "CARTAO_DEBITO"
    | "CREDITO_LOJA"
    | "VALE_ALIMENTACAO"
    | "VALE_REFEICAO"
    | "PIX"
    | "SEM_PAGAMENTO"
    | "OUTROS";
  valor: number;
  /** Troco — só faz sentido em DINHEIRO. */
  troco?: number;
};

export type DocumentoParaEmitir = {
  modelo: FiscalModelo;
  serie: number;
  numero: number;
  naturezaOperacao: string;
  dataEmissao: Date;
  emitente: EmitenteFiscal;
  destinatario: DestinatarioFiscal | null;
  itens: ItemFiscal[];
  pagamentos: PagamentoFiscal[];
  valorProdutos: number;
  valorDesconto: number;
  valorTotal: number;
  informacoesComplementares: string | null;
  /**
   * Chave de idempotência (usamos o id do FiscalDocument). Retry de rede não
   * pode virar nota duplicada — o adapter repassa ao provedor.
   */
  idempotencyKey: string;
  /** Emitir em contingência offline (SEFAZ fora do ar). */
  contingencia?: boolean;
};

export type ResultadoFiscal = {
  status: StatusFiscal;
  /** Id do documento no provedor — usado para consultar/cancelar depois. */
  externalId: string | null;
  chave: string | null; // 44 dígitos
  protocolo: string | null;
  dataAutorizacao: Date | null;
  /** cStat + xMotivo. Em REJEITADO, é isso que vai para a tela do operador. */
  codigo: string | null;
  mensagem: string | null;
  /** NFC-e: URL do QR Code e da consulta pública, impressas no cupom. */
  qrCodeUrl: string | null;
  urlConsulta: string | null;
  /** Retorno bruto, só para log/suporte. Nunca vire regra de negócio. */
  payload?: unknown;
};

export type ResultadoEvento = {
  aceito: boolean;
  protocolo: string | null;
  codigo: string | null;
  mensagem: string | null;
  dataEvento: Date | null;
  payload?: unknown;
};

export type CertificadoInfo = {
  id: string; // id opaco no provedor
  titular: string; // CN
  cnpj: string;
  validade: Date;
};

export type ArquivoFiscal = {
  conteudo: Uint8Array;
  contentType: string;
  nomeSugerido: string;
};

/** Falha de transporte/credencial/configuração — NÃO é rejeição da SEFAZ. */
export class FiscalProviderError extends Error {
  constructor(
    mensagem: string,
    readonly causa?: unknown,
  ) {
    super(mensagem);
    this.name = "FiscalProviderError";
  }
}

export interface FiscalProvider {
  slug: FiscalProviderKind;

  /** Leitura barata que só passa com credencial válida. */
  validarCredenciais?(): Promise<void>;

  // ── Certificado A1 ──
  /**
   * Sobe o .pfx UMA VEZ para o provedor, que passa a guardá-lo por CNPJ.
   * Devolve id + validade; a chave privada nunca volta nem fica conosco.
   */
  enviarCertificado(input: {
    cnpj: string;
    arquivo: Uint8Array;
    senha: string;
  }): Promise<CertificadoInfo>;

  /** Confere se o certificado do CNPJ ainda existe e está no prazo. */
  validarCertificado(cnpj: string): Promise<CertificadoInfo>;

  // ── Emissão ──
  emitirNFCe(doc: DocumentoParaEmitir): Promise<ResultadoFiscal>;
  emitirNFe(doc: DocumentoParaEmitir): Promise<ResultadoFiscal>;

  /** Estado atual — usado pelo polling do PDV e pela reconciliação. */
  consultarNota(input: {
    externalId: string;
    modelo: FiscalModelo;
  }): Promise<ResultadoFiscal>;

  // ── Eventos ──
  cancelarNota(input: {
    externalId: string;
    modelo: FiscalModelo;
    /** A SEFAZ exige no mínimo 15 caracteres. */
    justificativa: string;
  }): Promise<ResultadoEvento>;

  cartaCorrecao(input: {
    externalId: string;
    modelo: FiscalModelo;
    correcao: string;
    sequencia: number; // 1..20
  }): Promise<ResultadoEvento>;

  /** Queima uma faixa de numeração que não será usada (salto de número). */
  inutilizar(input: {
    cnpj: string;
    modelo: FiscalModelo;
    serie: number;
    numeroInicial: number;
    numeroFinal: number;
    justificativa: string;
  }): Promise<ResultadoEvento>;

  /** Manifestação do destinatário — habilita o download automático de XML. */
  manifestar(input: {
    cnpj: string;
    chave: string;
    tipo: "CIENCIA" | "CONFIRMACAO" | "DESCONHECIMENTO" | "NAO_REALIZADA";
    justificativa?: string;
  }): Promise<ResultadoEvento>;

  // ── Arquivos ──
  baixarXML(input: { externalId: string; modelo: FiscalModelo }): Promise<ArquivoFiscal>;
  baixarPDF(input: { externalId: string; modelo: FiscalModelo }): Promise<ArquivoFiscal>;
}
