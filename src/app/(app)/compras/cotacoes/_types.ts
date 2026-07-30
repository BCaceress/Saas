// DTOs das Cotações (RFQ) — tudo serializável (Decimal/Date já viram
// number/string no loader), porque atravessa a fronteira RSC → client.

export type CotacaoStatus = "RASCUNHO" | "ABERTA" | "ENCERRADA" | "DECIDIDA" | "CANCELADA";
export type ConviteStatus = "PENDENTE" | "ENVIADA" | "RESPONDIDA" | "RECUSADA";

/** Linha da lista de cotações. */
export type CotacaoRow = {
  id: string;
  numero: string;
  titulo: string;
  status: CotacaoStatus;
  siteNome: string;
  prazoResposta: string | null;
  criadaEm: string;
  totalItens: number;
  totalConvidados: number;
  totalRespondidos: number;
  /** Menor soma entre os fornecedores que responderam tudo — null se ninguém fechou. */
  melhorTotal: number | null;
};

export type ResumoCotacoes = {
  abertas: number;
  aguardandoResposta: number; // convites enviados e ainda sem resposta
  prazoVencendo: number; // abertas com prazo em até 2 dias (ou vencido)
  economiaPotencial: number; // Σ (pior − melhor) por item nas cotações abertas/encerradas
};

export type ItemCotacao = {
  id: string;
  productId: string | null;
  packagingId: string | null;
  descricao: string;
  quantidade: number;
  observacao: string | null;
  ordem: number;
  /** Do produto vinculado — some quando o item é texto livre. */
  sku: string | null;
  imagemUrl: string | null;
  embalagemNome: string | null;
};

export type RespostaItem = {
  quotationItemId: string;
  disponivel: boolean;
  precoUnitario: number;
  quantidadeOfertada: number | null;
  marca: string | null;
  observacao: string | null;
};

export type ConviteCotacao = {
  id: string;
  supplierId: string;
  supplierNome: string;
  telefone: string | null;
  email: string | null;
  status: ConviteStatus;
  enviadaEm: string | null;
  respondidaEm: string | null;
  prazoEntregaDias: number | null;
  condicaoPagamento: string | null;
  frete: number | null;
  observacao: string | null;
  purchaseOrderId: string | null;
  respostas: RespostaItem[];
  /** Σ preço × quantidade pedida dos itens disponíveis + frete. */
  total: number;
  /** Quantos itens da cotação este fornecedor consegue atender. */
  itensAtendidos: number;
};

export type CotacaoDetalhe = {
  id: string;
  numero: string;
  titulo: string;
  status: CotacaoStatus;
  siteId: string;
  siteNome: string;
  prazoResposta: string | null;
  observacao: string | null;
  criadaEm: string;
  enviadaEm: string | null;
  itens: ItemCotacao[];
  convites: ConviteCotacao[];
};

/** Produto disponível para entrar na lista de itens. */
export type ProdutoOpcao = {
  id: string;
  nome: string;
  sku: string;
  imagemUrl: string | null;
  packagings: { id: string; nome: string; isCompraDefault: boolean }[];
};

export type FornecedorOpcao = {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
};

export type OpcoesCotacao = {
  produtos: ProdutoOpcao[];
  fornecedores: FornecedorOpcao[];
  sites: { id: string; nome: string }[];
};
