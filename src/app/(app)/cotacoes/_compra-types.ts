// DTOs das Compras (evolução do Quotation/RFQ) — tudo serializável
// (Decimal/Date já viram number/string no loader), porque atravessa a
// fronteira RSC → client.
//
// O nome é o mesmo dentro e fora: cotação. O rótulo de ANDAMENTO que o
// operador lê é derivado da contagem de convites (ver `_status.ts`), não uma
// coluna nova.

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
  /** Convites que responderam "não vou cotar" — não são resposta nem espera. */
  totalRecusados: number;
  /** Menor soma entre os fornecedores que responderam tudo — null se ninguém fechou. */
  melhorTotal: number | null;
};

/** Cards do topo da lista de cotações. */
export type ResumoCompras = {
  /** Cotações em RASCUNHO — ainda montando a lista. */
  planejamento: number;
  /** Cotações em ABERTA — pergunta feita, resposta pendente. */
  cotando: number;
  /** Σ quantidade × melhor preço conhecido por item, nas cotações ainda ativas
   *  (RASCUNHO/ABERTA/ENCERRADA) — calculado na leitura, sem coluna nova. */
  valorPrevisto: number;
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
  /** Estoque na loja de destino da cotação — null quando o item não tem produto vinculado. */
  estoqueAtual: number | null;
  estoqueMinimo: number | null;
};

export type RespostaItem = {
  quotationItemId: string;
  disponivel: boolean;
  precoUnitario: number;
  quantidadeOfertada: number | null;
  marca: string | null;
  observacao: string | null;
};

/** Pessoa do fornecedor que pode receber a cotação. */
export type ContatoConvite = {
  id: string;
  nome: string;
  cargo: string | null;
  telefone: string | null;
  email: string | null;
  principal: boolean;
};

/** Uma linha do histórico de envio: para quem foi, por onde e quando. */
export type EnvioConvite = {
  id: string;
  canal: "WHATSAPP" | "EMAIL";
  contatoNome: string | null;
  destino: string | null;
  reenvio: boolean;
  sucesso: boolean;
  erro: string | null;
  enviadoEm: string;
};

export type ConviteCotacao = {
  id: string;
  supplierId: string;
  supplierNome: string;
  supplierLogoUrl: string | null;
  telefone: string | null;
  email: string | null;
  status: ConviteStatus;
  /** Contato escolhido para este convite — null cai no telefone da empresa. */
  contatoId: string | null;
  /** Todos os contatos do fornecedor: é a lista do "Trocar" no envio. */
  contatos: ContatoConvite[];
  /** Quem já recebeu, por qual canal e quando — mais novo primeiro. */
  envios: EnvioConvite[];
  enviadaEm: string | null;
  respondidaEm: string | null;
  /** Quando o fornecedor ABRIU o link. Separa "ignorou" de "está pensando". */
  abertoEm: string | null;
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
  logoUrl: string | null;
  telefone: string | null;
  email: string | null;
  /** Contatos cadastrados — o principal já entra selecionado no envio. */
  contatos: ContatoConvite[];
};

export type OpcoesCotacao = {
  produtos: ProdutoOpcao[];
  fornecedores: FornecedorOpcao[];
  sites: { id: string; nome: string }[];
};
