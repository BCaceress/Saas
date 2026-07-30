import type { SupplierIntegrationKind } from "@/generated/prisma";

// ============================================================
// Contrato único do módulo Compras com Fornecedores.
//
// Todo conector — API, planilha, CSV, PDF, imagem, XML, JSON ou digitação —
// devolve `OfertaBruta[]`. Do ingest para frente (vínculo com produto,
// comparador, cesta, carrinho, histórico) ninguém mais sabe de onde o dado
// veio. É o que permite plugar fornecedor novo sem tocar no resto do sistema.
// ============================================================

/** Oferta como o conector leu — ainda sem vínculo com o produto do tenant. */
export type OfertaBruta = {
  /** Código do item no fornecedor (cProd). Primeira escolha para casar item. */
  codigoFornecedor?: string | null;
  ean?: string | null;
  descricao: string;
  marca?: string | null;
  categoria?: string | null;
  imagemUrl?: string | null;
  /** Unidade de compra como o fornecedor escreve: "UN", "CX 12", "FD 6". */
  unidade?: string | null;
  /** Unidades do produto por unidade de compra (caixa com 12 → 12). */
  fatorConversao?: number | null;
  preco: number;
  precoPromocional?: number | null;
  quantidadeMinima?: number | null;
  estoqueDisponivel?: number | null;
  /** Até quando a oferta vale. */
  validadeOferta?: Date | null;
};

/** Oferta já vinculada — o formato que o resto do sistema consome. */
export type OfertaNormalizada = OfertaBruta & {
  fornecedorId: string;
  produtoId: string | null;
  ultimaAtualizacao: Date;
};

// ── Fonte de dados ──────────────────────────────────────────

export type FonteArquivo = {
  tipo: "arquivo";
  nome: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type FonteApi = {
  tipo: "api";
  endpoint: string;
  authTipo?: string | null;
  /** Já decifrada — nunca guarde o valor em claro. */
  credencial?: string | null;
  headers?: Record<string, string> | null;
};

export type FonteManual = { tipo: "manual"; ofertas: OfertaBruta[] };

export type Fonte = FonteArquivo | FonteApi | FonteManual;

/** Mapa "coluna do arquivo" → campo interno. Nulo = detecção automática. */
export type MapeamentoColunas = Partial<Record<CampoOferta, string>>;

export type CampoOferta =
  | "codigoFornecedor"
  | "ean"
  | "descricao"
  | "marca"
  | "categoria"
  | "unidade"
  | "fatorConversao"
  | "preco"
  | "precoPromocional"
  | "quantidadeMinima"
  | "estoqueDisponivel"
  | "validadeOferta";

export type ContextoConector = {
  supplierId: string;
  mapeamento?: MapeamentoColunas | null;
};

export type ResultadoConector = {
  ofertas: OfertaBruta[];
  /** Linhas lidas na origem, inclusive as descartadas. */
  totalLinhas: number;
  /** Problemas que não impedem a importação (linha sem preço, coluna ausente). */
  avisos: string[];
};

export interface ConectorFornecedor {
  kind: SupplierIntegrationKind;
  rotulo: string;
  /** Extensões aceitas na tela de importação (vazio = não recebe arquivo). */
  extensoes: string[];
  ler(fonte: Fonte, ctx: ContextoConector): Promise<ResultadoConector>;
}

// ── Rótulos de interface (pt-BR) ────────────────────────────

export const KIND_LABEL: Record<SupplierIntegrationKind, string> = {
  API: "API",
  PLANILHA: "Planilha (Excel)",
  CSV: "CSV",
  PDF: "PDF",
  IMAGEM: "Imagem",
  XML: "XML",
  JSON: "JSON",
  MANUAL: "Manual",
};

export class ConectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConectorError";
  }
}
